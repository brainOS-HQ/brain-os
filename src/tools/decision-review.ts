import { Decision } from "../schemas/decision.js";
import { Entity } from "../schemas/entity.js";
import { readJsonFile, listJsonFiles, getDecisionsDir, getEntitiesDir, assertSafeId } from "../utils/file-store.js";
import { today } from "../utils/staleness.js";
import { join } from "node:path";

// ──────────────────────────────────────────────────────────────────────────
// decision_review — v1
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
//                    self-dated review). This is the pattern cleared by hand on
//                    tasha-brain; auto-detecting it is the headline feature.
//   needs_evidence → active, overdue, but no evidence it still holds.
//   still_true     → overdue but has supporting evidence / substance; refresh it.
//   changed        → NOT auto-detected in v1 (deciding a decision no longer holds
//                    is human judgment). Left empty; surfaced in `notes`.
//
// Read-only. No mutation, no audit, no LLM. Returns ALL candidate suggestions
// and their reasons; the human decides and applies.
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
  proof_action: string;
  duplicate_of?: string;
  // The testable frame: the premises behind the decision and the conditions that
  // would make it false. Surfaced so the human reviewing has them in front of
  // them rather than re-deriving — turns a timestamped "no" into "still true if
  // these assumptions hold; revisit if these conditions changed."
  assumptions?: string[];
  invalidate_if?: string[];
}

export interface DecisionReviewInput {
  entity_id?: string;
  limit?: number;
  include_parked?: boolean;
}

export interface DecisionReviewResult {
  entity_id: string | null;
  overdue_count: number;
  shown_count: number;
  groups: Record<ReviewBucket, DecisionReviewItem[]>;
  notes: string[];
}

const DEFAULT_LIMIT = 5;

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

export async function reviewDecisions(input: DecisionReviewInput): Promise<DecisionReviewResult> {
  if (input.entity_id) assertSafeId(input.entity_id, "entity_id");
  const limit = input.limit && input.limit > 0 ? input.limit : DEFAULT_LIMIT;
  const todayStr = today();

  const allDecisions = (await readJsonFile<Decision[]>(join(getDecisionsDir(), "decisions.json"))) ?? [];

  // Entities — for mode (hide parked/archived), priority, name, blocker.
  const entityFiles = await listJsonFiles(getEntitiesDir());
  const entities = new Map<string, Entity>();
  for (const f of entityFiles) {
    const e = await readJsonFile<Entity>(f);
    if (e) entities.set(e.id, e);
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

    // ── Ranking ───────────────────────────────────────────────────────────
    const priority =
      ageDays +
      entityPriorityWeight(ent?.priority) +
      (ent?.blocked ? 10 : 0) +
      (ent?.mode === "active" ? 5 : 0) +
      (bucket === "archive" ? 25 : 0) - // cheap, high-value cleanup floats up
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
      _priority: priority,
    });
  }

  items.sort((a, b) => b._priority - a._priority);

  const shown = items.slice(0, limit);
  if (items.length > shown.length) {
    notes.push(`${items.length} overdue decisions in scope; showing the top ${shown.length}. Re-run with a higher limit or a specific entity_id to see more.`);
  }
  if (shown.length && !shown.some((i) => i.bucket === "changed")) {
    notes.push('No "changed" items are auto-detected in v1 — deciding a decision no longer holds is human judgment. Move an item there yourself and apply via decision_log(supersedes=[id]).');
  }
  if (shown.some((i) => i.invalidate_if?.length)) {
    notes.push('Some items carry invalidate_if conditions. Test each against current reality: if a condition now holds, the decision\'s premise changed — move it to "changed" and supersede. If the assumptions still hold, refresh with confidence.');
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
