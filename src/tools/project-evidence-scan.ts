import { readdirSync, existsSync, statSync, lstatSync, openSync, readSync, closeSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { devNull } from "node:os";

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
const MAX_FILE_BYTES = 1_000_000;
const MAX_HITS_PER_BUCKET = 25;
const MAX_LINE_LEN = 240;

function trimLine(line: string): string {
  const t = line.trim();
  return t.length > MAX_LINE_LEN ? t.slice(0, MAX_LINE_LEN - 1) + "…" : t;
}

// Git has more repository-routing variables than GIT_DIR / GIT_WORK_TREE /
// GIT_INDEX_FILE (for example GIT_OBJECT_DIRECTORY and GIT_COMMON_DIR). Strip
// the full GIT_* namespace for these local, read-only subprocesses so no
// inherited hook/runner environment can redirect discovery, refs, indexes, or
// object storage away from -C <root>.
//
// One variable is then set on purpose: GIT_NO_LAZY_FETCH=1. A folder whose
// config declares a promisor remote (extensions.partialClone, remote.<name>.promisor)
// makes Git fetch any object it finds missing, and remote.<name>.uploadpack
// names the program that fetch runs. Git 2.45 and later honour this variable
// and never start that fetch; older versions ignore it (see
// gitHonoursNoLazyFetch / folderHasPromisorConfig below).
export function sanitizedGitEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  env.GIT_NO_LAZY_FETCH = "1";
  return env;
}

let cachedGitVersion: string | null | undefined;

function installedGitVersion(): string | null {
  if (cachedGitVersion === undefined) {
    try {
      cachedGitVersion = execFileSync("git", ["--version"], {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
        env: sanitizedGitEnv(),
      });
    } catch {
      cachedGitVersion = null;
    }
  }
  return cachedGitVersion;
}

// GIT_NO_LAZY_FETCH exists since Git 2.45. A version that cannot be read is
// treated as older.
export function gitHonoursNoLazyFetch(versionText: string | null = installedGitVersion()): boolean {
  const match = /git version (\d+)\.(\d+)/.exec(versionText ?? "");
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 2 || (major === 2 && minor >= 45);
}

// True when the folder's own config (.git/config or .git/config.worktree)
// sets up a promisor remote. Also true when the config cannot be listed: the
// caller uses this to decide whether running Git is safe, so "unknown" must
// count as "yes".
export function folderHasPromisorConfig(root: string): boolean {
  let out: string;
  try {
    out = execFileSync(
      "git",
      [
        ...GIT_SAFE_CONFIG, "-C", root,
        "config", "--show-scope", "--includes", "--name-only", "--get-regexp",
        "^(extensions\\.partialclone|remote\\..*\\.promisor)$",
      ],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"], env: sanitizedGitEnv() },
    );
  } catch (error) {
    // Exit status 1 means "no such key" in any scope.
    return (error as { status?: number }).status !== 1;
  }
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) return true;
    const scope = line.slice(0, tab);
    if (scope === "local" || scope === "worktree") return true;
  }
  return false;
}

// The scanned folder's own .git/config is untrusted input: root_path comes from
// the caller, and a folder that was unpacked or shared (not cloned) can carry a
// config that names programs for Git to run. These command-line overrides win
// over repository config and switch off every such setting the fixed commands
// below (log, status, rev-parse) can reach: the fsmonitor program, hooks, and
// the signature-verification program used by `log` when log.showSignature is on.
// Content filters are handled separately by repoFilterOverrides(), because they
// can only be switched off by name.
export const GIT_SAFE_CONFIG: readonly string[] = [
  "-c", "core.fsmonitor=false",
  "-c", `core.hooksPath=${devNull}`,
  "-c", "log.showSignature=false",
];

// Run a read-only git command scoped to the repo. Returns trimmed non-empty
// lines, or null if git is unavailable / the path is not a repo.
function git(root: string, args: string[]): string[] | null {
  const env = sanitizedGitEnv();
  try {
    const out = execFileSync("git", [...GIT_SAFE_CONFIG, "-C", root, ...args], {
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

// `git status` re-hashes changed files, and that runs any content filter
// (filter.<name>.clean / .process) the folder's own config defines for them.
// List the filter drivers Git would actually use (reading config runs nothing)
// and blank each one that comes from the folder itself: .git/config ("local")
// and, when extensions.worktreeConfig is on, .git/config.worktree ("worktree"),
// which `git config --local` does not list. Drivers from the user's own global
// or system config are left alone. Returns null when the list cannot be read,
// or a driver name cannot be overridden safely on the command line; the caller
// must then not run `git status` at all.
function repoFilterOverrides(root: string): string[] | null {
  let out: string;
  try {
    out = execFileSync(
      "git",
      [
        ...GIT_SAFE_CONFIG, "-C", root,
        "config", "--show-scope", "--includes", "--name-only", "--get-regexp",
        "^filter\\..*\\.(clean|smudge|process)$",
      ],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"], env: sanitizedGitEnv() },
    );
  } catch (error) {
    // Exit status 1 means "no such key": no filter is defined anywhere.
    if ((error as { status?: number }).status === 1) return [];
    return null;
  }
  const overrides: string[] = [];
  const seen = new Set<string>();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    if (tab < 0) return null;
    const scope = line.slice(0, tab);
    const key = line.slice(tab + 1);
    if (scope !== "local" && scope !== "worktree") continue;
    if (/[=\s]/.test(key)) return null;
    if (seen.has(key)) continue;
    seen.add(key);
    overrides.push("-c", `${key}=`);
  }
  return overrides;
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
  // Only regular files that live in root_path itself. A symlink named like a
  // state file (HANDOFF.md -> anywhere) is skipped, never followed.
  let entries: string[] = [];
  const skippedLinks: string[] = [];
  try {
    entries = readdirSync(root).filter((name) => {
      try {
        const info = lstatSync(join(root, name));
        if (info.isSymbolicLink()) {
          if (FILE_PATTERNS.some((re) => re.test(name))) skippedLinks.push(name);
          return false;
        }
        return info.isFile();
      } catch {
        return false;
      }
    });
  } catch {
    result.warnings.push(`could not read directory: ${root}`);
  }
  for (const name of skippedLinks.sort()) {
    result.warnings.push(`skipped ${name}: it is a symbolic link, and the scan only reads files inside root_path.`);
  }

  const matchedFiles = entries.filter((name) => FILE_PATTERNS.some((re) => re.test(name))).sort();

  for (const name of matchedFiles) {
    let content: string;
    try {
      // Bounded read: at most MAX_FILE_BYTES, whatever the file's size.
      const fd = openSync(join(root, name), "r");
      try {
        const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
        const bytes = readSync(fd, buffer, 0, buffer.length, 0);
        if (bytes > MAX_FILE_BYTES) {
          result.warnings.push(`${name} is larger than ${MAX_FILE_BYTES} bytes; scanned the first ${MAX_FILE_BYTES}.`);
        }
        content = buffer.subarray(0, Math.min(bytes, MAX_FILE_BYTES)).toString("utf8");
      } finally {
        closeSync(fd);
      }
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
  // On a Git too old to honour GIT_NO_LAZY_FETCH, a folder that sets up a
  // promisor remote gets no Git commands at all (beyond reading its config).
  const lazyFetchUnstoppable =
    !gitHonoursNoLazyFetch() &&
    git(root, ["rev-parse", "--git-dir"]) !== null &&
    folderHasPromisorConfig(root);
  const log = lazyFetchUnstoppable ? null : git(root, ["log", "--oneline", "-10"]);
  if (lazyFetchUnstoppable) {
    result.warnings.push(
      "skipped all Git evidence: this folder's Git config sets up a partial-clone (promisor) remote, " +
        "and the installed Git is older than 2.45, which cannot be stopped from contacting that remote.",
    );
  } else if (log === null) {
    result.warnings.push("not a git repository, or git is unavailable — skipped commit/dirty-file evidence.");
  } else {
    result.recent_git_activity = log;
    result.evidence_used.push("git log (last 10)");
    const filterOverrides = repoFilterOverrides(root);
    if (filterOverrides === null) {
      result.warnings.push(
        "skipped dirty-file evidence: this folder's Git content filters could not be listed or switched off safely.",
      );
    } else {
      const status = git(root, [
        ...filterOverrides,
        "-c", "status.submoduleSummary=false",
        "status", "--porcelain", "--ignore-submodules=all",
      ]);
      if (status && status.length) {
        result.dirty_files = status;
        result.evidence_used.push("git status (dirty files)");
      }
    }
  }

  // ── 3. No-evidence warning ───────────────────────────────────────────────
  if (matchedFiles.length === 0 && log === null && !lazyFetchUnstoppable) {
    result.warnings.push(
      `no operating-state files (STATE.md, FLAGS*, HANDOFF*, ROADMAP.md, PLAN*.md, TODO.md, AGENTS.md) and no git history found at ${basename(root)}.`,
    );
  }

  return result;
}
