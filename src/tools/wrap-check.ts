import type { ToolContext } from "../storage/adapter.js";
import { AuditEntry } from "../utils/audit.js";

/**
 * wrap_check — Tier 1 of auto-wrap: detect how much state-changing work has
 * accumulated since the last wrap, so an agent can proactively offer to
 * checkpoint before context is lost (compaction, session end).
 *
 * Pure read over audit.jsonl — never mutates. The "intelligence" of deciding
 * what to remember stays with the wrap flow; this only answers "is there
 * enough unwrapped activity that a wrap is worth suggesting?"
 */

// Tools whose audit entries represent a real state mutation worth wrapping.
// Read-only tools (entity_read, focus_get, decision_check, audit_log, etc.)
// are intentionally excluded — looking at state is not unwrapped work.
const MUTATING_TOOLS = new Set([
  "entity_update",
  "decision_log",
  "decision_refresh",
  "plan_update",
  "pattern_detect",
  "memory_commit",
]);

// A completed wrap is the boundary. memory_commit is the conventional
// session-level marker the wrap flow writes; auto-wrap / manual wrap also log
// an explicit `session_wrapped` action so wrap_check has a clean boundary even
// when memory_commit is skipped (it is optional in the wrap protocol).
const WRAP_MARKER_TOOLS = new Set(["memory_commit"]);
const WRAP_MARKER_ACTION = "session_wrapped";

export interface WrapCheckResult {
  unwrapped_count: number;
  /** ISO timestamp of the last wrap, or "session-start" if never wrapped. */
  since: string;
  last_wrap_at: string | null;
  by_tool: Record<string, number>;
  entities_touched: string[];
  recommend_wrap: boolean;
  reason: string;
  malformed_lines: number;
}

export async function checkWrapStatus(
  ctx: ToolContext,
  options?: {
    /** Scope the check to one session's activity. Omit for the whole log tail. */
    session_id?: string;
    /** Unwrapped-mutation count at/above which a wrap is recommended. Default 5. */
    threshold?: number;
  }
): Promise<WrapCheckResult> {
  const threshold = options?.threshold ?? 5;

  const raw = await ctx.storage.readAuditLog();
  if (!raw) {
    return {
      unwrapped_count: 0,
      since: "session-start",
      last_wrap_at: null,
      by_tool: {},
      entities_touched: [],
      recommend_wrap: false,
      reason: "No audit history yet — nothing to wrap.",
      malformed_lines: 0,
    };
  }

  // Parse line-by-line, skipping malformed lines with a count (same resilience
  // contract as audit_log — interleaved appends can exceed PIPE_BUF).
  const lines = raw.trim().split("\n").filter(Boolean);
  let entries: AuditEntry[] = [];
  let malformed = 0;
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as AuditEntry);
    } catch {
      malformed++;
    }
  }

  if (options?.session_id) {
    entries = entries.filter((e) => e.session_id === options.session_id);
  }

  // Boundary = the most recent completed wrap. Everything after it is unwrapped.
  let boundaryIdx = -1;
  let lastWrapAt: string | null = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (WRAP_MARKER_TOOLS.has(e.tool) || e.action === WRAP_MARKER_ACTION) {
      boundaryIdx = i;
      lastWrapAt = e.timestamp;
      break;
    }
  }

  const sinceBoundary = entries.slice(boundaryIdx + 1);
  const mutations = sinceBoundary.filter((e) => MUTATING_TOOLS.has(e.tool));

  const byTool: Record<string, number> = {};
  const entitySet = new Set<string>();
  for (const e of mutations) {
    byTool[e.tool] = (byTool[e.tool] ?? 0) + 1;
    if (e.entity_id) entitySet.add(e.entity_id);
  }

  const unwrapped = mutations.length;
  const entities = [...entitySet].sort();

  // Recommend a wrap when enough mutations have piled up, or when work has
  // spread across multiple projects (cross-project sessions lose the most on
  // an un-wrapped compaction).
  const recommend = unwrapped >= threshold || entities.length >= 3;

  let reason: string;
  if (unwrapped === 0) {
    reason = lastWrapAt
      ? "Wrapped recently — nothing new to capture."
      : "No state changes yet — nothing to wrap.";
  } else {
    const span = entities.length
      ? ` across ${entities.length} project${entities.length === 1 ? "" : "s"}`
      : "";
    const when = lastWrapAt ? `since the last wrap` : `this session (never wrapped)`;
    reason = recommend
      ? `${unwrapped} unwrapped change${unwrapped === 1 ? "" : "s"}${span} ${when} — worth a wrap before context is lost.`
      : `${unwrapped} unwrapped change${unwrapped === 1 ? "" : "s"}${span} ${when} — below the suggest threshold.`;
  }

  return {
    unwrapped_count: unwrapped,
    since: lastWrapAt ?? "session-start",
    last_wrap_at: lastWrapAt,
    by_tool: byTool,
    entities_touched: entities,
    recommend_wrap: recommend,
    reason,
    malformed_lines: malformed,
  };
}
