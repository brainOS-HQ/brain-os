import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";

// ──────────────────────────────────────────────────────────────────────────
// project_evidence_scan — v1
//
// A READ-ONLY evidence adapter. Before focus_get gives advice, this lets Brain
// OS inspect repo-native operating state (STATE.md, FLAGS, HANDOFF docs, git)
// — not just .brain memory. It is deliberately NOT part of context_resolve:
//   - context_resolve answers "which project?" (routing known context).
//   - project_evidence_scan answers "what does the repo itself say right now?"
//
// Design rules (locked):
//   - READ-ONLY. Mutates nothing — not the target repo, not .brain. No audit
//     write (auditing is a .brain mutation; this tool stays side-effect free).
//   - NO LLM, NO inference. It surfaces exact lines that match known markers
//     and returns ALL candidates; deciding the final focus is focus_get's /
//     the agent's job, not this tool's.
//   - NO broad recursive full-text scan. Only known root-level filenames.
// ──────────────────────────────────────────────────────────────────────────

export interface ProjectEvidenceScanInput {
  root_path: string;
  entity_id?: string;
}

export interface ProjectEvidenceScanResult {
  root_path: string;
  entity_id?: string;
  evidence_used: string[];
  current_state_files: string[];
  recent_git_activity: string[];
  dirty_files: string[];
  detected_human_gates: string[];
  detected_blockers: string[];
  detected_next_moves: string[];
  do_not_touch: string[];
  safe_parallel_work: string[];
  warnings: string[];
}

// Root-level files we know carry operating state. Matched case-insensitively
// against the filename only — no recursion, no content globbing.
const FILE_PATTERNS: RegExp[] = [
  /^state\.md$/i,
  /^flags.*$/i, // FLAGS.md, FLAGS, FLAGS_2026.md
  /^handoff.*$/i, // HANDOFF.md, HANDOFF_2024-01-15.md
  /^roadmap\.md$/i,
  /^plan.*\.md$/i, // PLAN.md, PLAN_153.md, PLANNING.md
  /^todo\.md$/i,
  /^agents\.md$/i, // repo-specific constraints
];

// Markers → bucket. Each matched line is surfaced verbatim (trimmed, capped).
const MARKERS: Array<{ re: RegExp; bucket: keyof ProjectEvidenceScanResult }> = [
  { re: /human[\s_-]*gate/i, bucket: "detected_human_gates" },
  { re: /\bnext move\b/i, bucket: "detected_next_moves" }, // also catches "EXACT NEXT MOVE"
  { re: /do[\s_-]*not[\s_-]*touch/i, bucket: "do_not_touch" },
  { re: /\bblocked\b|\bblocker\b/i, bucket: "detected_blockers" },
  { re: /\bparallel\b|agent[\s_-]*safe|safe to run/i, bucket: "safe_parallel_work" },
];

const MAX_LINES_PER_FILE = 2000;
const MAX_HITS_PER_BUCKET = 25;
const MAX_LINE_LEN = 240;

function trimLine(line: string): string {
  const t = line.trim();
  return t.length > MAX_LINE_LEN ? t.slice(0, MAX_LINE_LEN - 1) + "…" : t;
}

// Run a read-only git command scoped to the repo. Returns trimmed non-empty
// lines, or null if git is unavailable / the path is not a repo.
function git(root: string, args: string[]): string[] | null {
  // Strip inherited GIT_* location vars so git resolves strictly from -C <root>.
  // An ambient GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE (e.g. set when a git hook
  // invokes a process that reaches this scan) otherwise OVERRIDES -C and the scan
  // hits the WRONG repo — root cause of the 2026-07-20 seed-commit incident.
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  try {
    const out = execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
      env,
    });
    return out.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim().length > 0);
  } catch {
    return null;
  }
}

export function scanProjectEvidence(input: ProjectEvidenceScanInput): ProjectEvidenceScanResult {
  const root = resolve(input.root_path);
  const result: ProjectEvidenceScanResult = {
    root_path: root,
    ...(input.entity_id ? { entity_id: input.entity_id } : {}),
    evidence_used: [],
    current_state_files: [],
    recent_git_activity: [],
    dirty_files: [],
    detected_human_gates: [],
    detected_blockers: [],
    detected_next_moves: [],
    do_not_touch: [],
    safe_parallel_work: [],
    warnings: [],
  };

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    result.warnings.push(`root_path does not exist or is not a directory: ${root}`);
    return result;
  }

  // ── 1. Known root-level operating-state files ────────────────────────────
  let entries: string[] = [];
  try {
    entries = readdirSync(root).filter((name) => {
      try {
        return statSync(join(root, name)).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    result.warnings.push(`could not read directory: ${root}`);
  }

  const matchedFiles = entries.filter((name) => FILE_PATTERNS.some((re) => re.test(name))).sort();

  for (const name of matchedFiles) {
    let content: string;
    try {
      content = readFileSync(join(root, name), "utf8");
    } catch {
      result.warnings.push(`could not read file: ${name}`);
      continue;
    }
    result.current_state_files.push(name);
    result.evidence_used.push(name);

    const lines = content.split(/\r?\n/);
    if (lines.length > MAX_LINES_PER_FILE) {
      result.warnings.push(`${name} is large (${lines.length} lines); scanned first ${MAX_LINES_PER_FILE}.`);
    }
    for (const raw of lines.slice(0, MAX_LINES_PER_FILE)) {
      for (const { re, bucket } of MARKERS) {
        if (re.test(raw)) {
          const arr = result[bucket] as string[];
          if (arr.length < MAX_HITS_PER_BUCKET) {
            const entry = `${name}: ${trimLine(raw)}`;
            if (!arr.includes(entry)) arr.push(entry);
          }
        }
      }
    }
  }

  // ── 2. Git activity (read-only) ──────────────────────────────────────────
  const log = git(root, ["log", "--oneline", "-10"]);
  if (log === null) {
    result.warnings.push("not a git repository, or git is unavailable — skipped commit/dirty-file evidence.");
  } else {
    result.recent_git_activity = log;
    result.evidence_used.push("git log (last 10)");
    const status = git(root, ["status", "--porcelain"]);
    if (status && status.length) {
      result.dirty_files = status;
      result.evidence_used.push("git status (dirty files)");
    }
  }

  // ── 3. No-evidence warning ───────────────────────────────────────────────
  if (matchedFiles.length === 0 && log === null) {
    result.warnings.push(
      `no operating-state files (STATE.md, FLAGS*, HANDOFF*, ROADMAP.md, PLAN*.md, TODO.md, AGENTS.md) and no git history found at ${basename(root)}.`,
    );
  }

  return result;
}
