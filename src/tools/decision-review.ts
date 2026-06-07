import { Decision } from "../schemas/decision.js";
import { Entity } from "../schemas/entity.js";
import { assertSafeId } from "../utils/file-store.js";
import { today } from "../utils/staleness.js";
import { scanProjectEvidence, ProjectEvidenceScanResult } from "./project-evidence-scan.js";
import type { ToolContext } from "../storage/adapter.js";

// ──────────────────────────────────────────────────────────────────────────
// decision_review — v2 (v0.8.0)
//
// The review-debt INBOX. focus_get tells you review debt exists; decision_review
// clears it in batches by BUCKETING overdue decisions and recommending an action
// for each — but it mutates NOTHING. The user confirms, then applies via the
// existing tools (decision_refresh / decision_log). This honors dec-051:
// "system proposes keep/merge/archive/drop, user confirms, nothing dies
// automatically."
//
// Buckets:
//   archive        → duplicate stub of a canonical decision (HIGH confidence,
//                    deterministic: same text + placeholder proof_action +
//                    self-dated review).
//   needs_evidence → active, overdue, but no evidence it still holds.
//   still_true     → overdue but has supporting evidence / substance; refresh it.
//   changed        → v0.8.0: auto-detected when root_path is provided and
//                    project_evidence_scan output matches an invalidate_if
//                    condition (keyword match). Also accepts human-moved items.
//                    Matched evidence is cited in triggered_invalidate_if.
//
// Read-only. No mutation, no LLM. Returns ALL candidate suggestions and their
// reasons; the human decides and applies.
// ──────────────────────────────────────────────────────────────────────────

export type ReviewBucket = "still_true" | "changed" | "archive" | "needs_evidence";

export interface DecisionReviewItem {
  decision_id: string;
  entity_id: string;
  entity_name: string;
  decision: string;
  review_date: string;
  age_days: number;
  bucket: ReviewBucket;
  suggested_action: string;
  apply_with: string; // which existing tool applies this — guidance only
  reason: string;
  confidence: number; // 0..1, derived from which deterministic signal fired
  evidence_count: number;
  proof_action?: string;
  duplicate_of?: string;
  // The testable frame: the premises behind the decision and the conditions that
  // would make it false. Surfaced so the human reviewing has them in front of
  // them rather than re-deriving — turns a timestamped "no" into "still true if
  // these assumptions hold; revisit if these conditions changed."
  assumptions?: string[];
  invalidate_if?: string[];
  // Populated when root_path is provided and scan output matched one or more
  // invalidate_if conditions. Each entry names the condition and cites the
  // specific scan lines that triggered it.
  triggered_invalidate_if?: Array<{ condition: string; matched_evidence: string[] }>;
}

export interface DecisionReviewInput {
  entity_id?: string;
  limit?: number;
  include_parked?: boolean;
  // When provided, project_evidence_scan runs against this path and its output
  // is matched against each decision's invalidate_if conditions. Matches move
  // the item to the "changed" bucket with cited evidence.
  root_path?: string;
}

export interface DecisionReviewResult {
  entity_id: string | null;
  overdue_count: number;
  shown_count: number;
  groups: Record<ReviewBucket, DecisionReviewItem[]>;
  notes: string[];
}

const DEFAULT_LIMIT = 5;

// ── Scan-based invalidation helpers ─────────────────────────────────────────

const STOP_WORDS = new Set([
  "that", "this", "with", "from", "have", "been", "will", "they", "when",
  "what", "which", "your", "their", "there", "where", "would", "could",
  "should", "into", "than", "then", "also", "some", "more", "very", "just",
  "about", "make", "does", "still", "after", "before", "each", "even",
]);

// Flatten all human-readable text from a scan result into a list of lowercase
// lines for keyword matching. File-path-only fields (dirty_files) are included
// but tend to contribute less signal — that's fine.
function buildScanCorpus(scan: ProjectEvidenceScanResult): string[] {
  return [
    ...scan.recent_git_activity,
    ...scan.detected_next_moves,
    ...scan.detected_blockers,
    ...scan.detected_human_gates,
    ...scan.do_not_touch,
    ...scan.safe_parallel_work,
    ...scan.dirty_files,
  ].map((l) => l.toLowerCase());
}

// Check a single invalidate_if condition string against corpus lines.
// Returns the corpus lines that matched (empty = no match).
// Rule: ≥2 significant words must appear in the same line, or ≥1 if the
// condition has only one significant word (rare but valid).
function matchCondition(condition: string, corpusLines: string[]): string[] {
  const words = condition
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  if (words.length === 0) return [];
  const threshold = Math.min(2, words.length);

  return corpusLines.filter((line) => {
    const hits = words.filter((w) => line.includes(w));
    return hits.length >= threshold;
  });
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// A "stub" is a placeholder decision: no real validation action and review_date
// set to its own creation date (i.e. "review in next session" deferral noise).
function isPlaceholderProof(proof: string | undefined): boolean {
  const p = (proof ?? "").trim();
  if (p.length === 0) return true;
  return /review (in|next|later)\b|next session|^tbd$|^n\/?a$|^revisit$/i.test(p);
}

function isSelfDated(d: Decision): boolean {
  return Boolean(d.date && d.review_date && d.date === d.review_date);
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = new Date(fromYmd).getTime();
  const b = new Date(toYmd).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

function entityPriorityWeight(priority?: string): number {
  switch (priority) {
    case "critical": return 30;
    case "high": return 20;
    case "medium": return 10;
    case "low": return 5;
    default: return 10;
  }
}

export async function reviewDecisions(input: DecisionReviewInput, ctx: ToolContext): Promise<DecisionReviewResult> {
  if (input.entity_id) assertSafeId(input.entity_id, "entity_id");
  const limit = input.limit && input.limit > 0 ? input.limit : DEFAULT_LIMIT;
  const todayStr = today();

  // ── Scan corpus (optional) ─────────────────────────────────────────────
  let scanCorpus: string[] | null = null;
  let scanWarnings: string[] = [];
  if (input.root_path) {
    try {
      const scan = scanProjectEvidence({ root_path: input.root_path });
      scanCorpus = buildScanCorpus(scan);
      if (scan.warnings.length) scanWarnings = scan.warnings;
    } catch {
      scanWarnings = [`project_evidence_scan failed for path: ${input.root_path}`];
    }
  }

  const allDecisions = (await ctx.storage.getDecisions(input.entity_id)) ?? [];

  // Entities — for mode (hide parked/archived), priority, name, blocker.
  const entityList = await ctx.storage.listEntities();
  const entities = new Map<string, Entity>();
  for (const e of entityList) {
    entities.set(e.id, e);
  }

  const notes: string[] = [];

  // Active decisions on the entity, by entity — used for duplicate detection.
  const activeByEntity = new Map<string, Decision[]>();
  for (const d of allDecisions) {
    if (d.status !== "active") continue;
    const arr = activeByEntity.get(d.entity_id) ?? [];
    arr.push(d);
    activeByEntity.set(d.entity_id, arr);
  }

  // Overdue + in-scope + (entity not parked/archived unless asked).
  const overdue = allDecisions.filter((d) => {
    if (d.status !== "active") return false;
    if (d.review_date > todayStr) return false;
    if (input.entity_id && d.entity_id !== input.entity_id) return false;
    const ent = entities.get(d.entity_id);
    if (!input.include_parked && ent && (ent.mode === "parked" || ent.mode === "archived")) return false;
    return true;
  });

  const items: Array<DecisionReviewItem & { _priority: number }> = [];

  for (const d of overdue) {
    const ent = entities.get(d.entity_id);
    const entityName = ent?.name ?? d.entity_id;
    const ageDays = Math.max(0, daysBetween(d.review_date, todayStr));
    const evidenceCount = d.evidence_appended?.length ?? 0;

    // ── Duplicate-stub detection → archive ──────────────────────────────────
    // A stub is a duplicate when another active decision on the SAME entity has
    // the same text but is NOT itself a stub (the canonical one carries the real
    // proof_action / alternatives / a forward review date).
    let bucket: ReviewBucket;
    let suggested_action: string;
    let apply_with: string;
    let reason: string;
    let confidence: number;
    let duplicate_of: string | undefined;

    const thisIsStub = isPlaceholderProof(d.proof_action) && isSelfDated(d);
    const siblings = (activeByEntity.get(d.entity_id) ?? []).filter(
      (o) => o.id !== d.id && normalizeText(o.decision) === normalizeText(d.decision),
    );
    const canonical = siblings.find((o) => !(isPlaceholderProof(o.proof_action) && isSelfDated(o)));

    if (thisIsStub && canonical) {
      bucket = "archive";
      suggested_action = `Archive as a duplicate stub of ${canonical.id}.`;
      apply_with = `decision_refresh(decision_id="${d.id}", status="archived", add_evidence="duplicate of ${canonical.id}")`;
      reason = `Placeholder proof_action ("${d.proof_action}") and review_date == creation date (${d.date}); same text as canonical ${canonical.id}, which has a real proof action / review date.`;
      confidence = 0.9;
      duplicate_of = canonical.id;
    } else if (evidenceCount === 0) {
      // ── No evidence it still holds → needs_evidence ───────────────────────
      bucket = "needs_evidence";
      suggested_action = isPlaceholderProof(d.proof_action)
        ? "Keep active, but set a real proof action — current one is a placeholder."
        : "Keep active; gather evidence the decision still holds, then refresh.";
      apply_with = `decision_refresh(decision_id="${d.id}", add_evidence="…") once proof exists; or log a new proof action`;
      reason = isPlaceholderProof(d.proof_action)
        ? `No evidence appended and proof_action is a placeholder ("${d.proof_action}").`
        : `No evidence appended yet; proof_action "${d.proof_action}" is unverified.`;
      confidence = 0.6;
    } else {
      // ── Has supporting evidence → still_true (refresh) ────────────────────
      bucket = "still_true";
      suggested_action = "Looks still valid — refresh the review date and append evidence.";
      apply_with = `decision_refresh(decision_id="${d.id}", review_date="<future>", add_evidence="…")`;
      reason = `${evidenceCount} evidence entr${evidenceCount === 1 ? "y" : "ies"} appended; no contradiction signal. Refresh rather than re-litigate.`;
      confidence = 0.7;
    }

    // ── Scan-based invalidation (v0.8.0) ──────────────────────────────────
    // If root_path was provided and this decision has invalidate_if conditions,
    // check each against the scan corpus. A match moves the item to "changed"
    // regardless of its initial bucket (except "archive" — stubs are still stubs).
    let triggered_invalidate_if: Array<{ condition: string; matched_evidence: string[] }> | undefined;

    if (scanCorpus && d.invalidate_if?.length && bucket !== "archive") {
      const hits: Array<{ condition: string; matched_evidence: string[] }> = [];
      for (const condition of d.invalidate_if) {
        const matched = matchCondition(condition, scanCorpus);
        if (matched.length > 0) {
          hits.push({ condition, matched_evidence: matched });
        }
      }
      if (hits.length > 0) {
        triggered_invalidate_if = hits;
        bucket = "changed";
        const conditionList = hits.map((h) => `"${h.condition}"`).join("; ");
        suggested_action = `One or more invalidate_if conditions appear to be met. Review the matched evidence and decide whether this decision still holds, needs updating, or should be superseded.`;
        apply_with = `decision_log(entity_id="${d.entity_id}", decision="<updated>", supersedes=["${d.id}"]) to supersede, or decision_refresh(decision_id="${d.id}", add_evidence="…") if still true`;
        reason = `Scan matched invalidate_if condition(s): ${conditionList}. Evidence sourced from: git log, STATE/PLAN/ROADMAP files.`;
        confidence = 0.75;
      }
    }

    // ── Ranking ───────────────────────────────────────────────────────────
    const priority =
      ageDays +
      entityPriorityWeight(ent?.priority) +
      (ent?.blocked ? 10 : 0) +
      (ent?.mode === "active" ? 5 : 0) +
      (bucket === "archive" ? 25 : 0) + // cheap, high-value cleanup floats up
      (triggered_invalidate_if ? 30 : 0) - // scan-triggered decisions are urgent
      (evidenceCount > 0 ? 10 : 0);

    items.push({
      decision_id: d.id,
      entity_id: d.entity_id,
      entity_name: entityName,
      decision: d.decision,
      review_date: d.review_date,
      age_days: ageDays,
      bucket,
      suggested_action,
      apply_with,
      reason,
      confidence,
      evidence_count: evidenceCount,
      proof_action: d.proof_action,
      ...(duplicate_of ? { duplicate_of } : {}),
      ...(d.assumptions?.length ? { assumptions: d.assumptions } : {}),
      ...(d.invalidate_if?.length ? { invalidate_if: d.invalidate_if } : {}),
      ...(triggered_invalidate_if ? { triggered_invalidate_if } : {}),
      _priority: priority,
    });
  }

  items.sort((a, b) => b._priority - a._priority);

  const shown = items.slice(0, limit);
  if (items.length > shown.length) {
    notes.push(`${items.length} overdue decisions in scope; showing the top ${shown.length}. Re-run with a higher limit or a specific entity_id to see more.`);
  }
  if (scanWarnings.length) {
    for (const w of scanWarnings) notes.push(`scan warning: ${w}`);
  }
  const autoChanged = shown.filter((i) => i.bucket === "changed" && i.triggered_invalidate_if?.length);
  if (autoChanged.length) {
    notes.push(
      `${autoChanged.length} decision(s) moved to "changed" because project_evidence_scan matched their invalidate_if conditions. ` +
      `Matches are keyword-based — verify the evidence before superseding. ` +
      `Apply with: decision_log(…, supersedes=[id]) to supersede, or decision_refresh(…) if it still holds.`,
    );
  } else if (shown.length && !shown.some((i) => i.bucket === "changed")) {
    if (input.root_path) {
      notes.push('No invalidate_if conditions were triggered by the project scan. Decisions appear stable against current repo state.');
    } else {
      notes.push('"changed" is not auto-detected without a root_path. Pass root_path to enable scan-based invalidation matching. Or move an item there yourself and apply via decision_log(supersedes=[id]).');
    }
  }
  if (shown.some((i) => i.invalidate_if?.length && !i.triggered_invalidate_if?.length)) {
    notes.push('Some items have invalidate_if conditions that were not triggered by the scan. Re-run with a different root_path, or evaluate them manually.');
  }

  const groups: Record<ReviewBucket, DecisionReviewItem[]> = {
    still_true: [],
    changed: [],
    archive: [],
    needs_evidence: [],
  };
  for (const it of shown) {
    const { _priority, ...item } = it;
    groups[item.bucket].push(item);
  }

  return {
    entity_id: input.entity_id ?? null,
    overdue_count: items.length,
    shown_count: shown.length,
    groups,
    notes,
  };
}
