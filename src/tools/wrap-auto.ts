import { updateEntity } from "./entity-update.js";
import { audit } from "../utils/audit.js";
import { assertSafeId } from "../utils/file-store.js";
import type { ToolContext } from "../storage/adapter.js";

/**
 * wrap_auto — Tier 2 of auto-wrap: persist a session wrap WITHOUT interactive
 * review, when context is about to be lost (compaction, session end) or the
 * user opted out of reviewing. The agent does the reasoning (what changed, what
 * to remember); this tool persists it with the right provenance so nothing is
 * lost and nothing machine-made is silently trusted.
 *
 * Provenance model — design C ("blend"):
 *   - LOW-RISK fields (next_move, open_questions, evidence_of_progress) are
 *     applied to the entity immediately. They are additive/easily corrected, and
 *     a current next_move + open threads are exactly what a recovered session
 *     needs most.
 *   - HIGH-RISK changes (status, mode, blocked, decisions) are NOT applied. They
 *     are staged as an unconfirmed auto-wrap record for /start to surface and the
 *     user to confirm / edit / discard. A wrong auto-guessed status or an
 *     un-reviewed decision should never enter trusted state unseen.
 *
 * Always logs a `session_wrapped` audit marker so wrap_check sees a clean
 * boundary even though this wasn't a manual /wrap.
 */

interface PendingReview {
  status?: string;
  mode?: "active" | "parked" | "incubating" | "archived";
  mode_reason?: string;
  blocked?: string | null;
  decisions?: Array<{ decision: string; why: string }>;
}

export interface WrapAutoInput {
  entity_id: string;
  /** One-line synthesized session summary. */
  summary: string;
  // Low-risk — applied to the entity now:
  next_move?: string;
  evidence_of_progress?: string;
  open_questions?: string[];
  // High-risk — staged for review, never applied here:
  pending_review?: PendingReview;
  /** Host session id, when known. */
  session_id?: string;
  /** What triggered the auto-wrap: precompact | sessionend | manual-no-review. */
  trigger?: string;
}

export interface WrapAutoResult {
  entity_id: string;
  applied: string[];
  staged: string[];
  pending_id: string | null;
  confirmed: false;
  note: string;
}

export async function wrapAuto(input: WrapAutoInput, ctx: ToolContext): Promise<WrapAutoResult> {
  assertSafeId(input.entity_id, "entity_id");

  // ── Low-risk: apply immediately (entity_update handles the smart merges —
  // evidence appends, open_questions dedup-merge, next_move set). ──
  const lowRisk: Record<string, unknown> = {};
  if (input.next_move !== undefined) lowRisk.next_move = input.next_move;
  if (input.evidence_of_progress !== undefined) lowRisk.evidence_of_progress = input.evidence_of_progress;
  if (input.open_questions !== undefined) lowRisk.open_questions = input.open_questions;

  let applied: string[] = [];
  if (Object.keys(lowRisk).length > 0) {
    const result = await updateEntity(input.entity_id, lowRisk, ctx);
    applied = result.changes;
  }

  // ── High-risk: stage as an unconfirmed auto-wrap record. ──
  const pr = input.pending_review ?? {};
  const staged: string[] = [];
  if (pr.status !== undefined) staged.push(`status → "${pr.status}"`);
  if (pr.mode !== undefined) staged.push(`mode → "${pr.mode}"`);
  if (pr.blocked !== undefined) staged.push(pr.blocked ? `blocked: ${pr.blocked}` : "clear blocker");
  if (pr.decisions && pr.decisions.length > 0) staged.push(`${pr.decisions.length} decision(s) to confirm`);

  let pendingId: string | null = null;
  if (staged.length > 0) {
    // Tools may use Date.now() (memory_commit does); id stays kebab-safe.
    pendingId = `autowrap-${Date.now()}`;
    const record = {
      id: pendingId,
      type: "auto_wrap",
      status: "captured",
      confirmed: false,
      source: "auto",
      trigger: input.trigger ?? "unknown",
      entity_id: input.entity_id,
      session_id: input.session_id ?? null,
      created_at: new Date().toISOString(),
      summary: input.summary,
      applied,
      pending_review: pr,
    };
    await ctx.storage.putSession(pendingId, record);
  }

  // ── Boundary marker so wrap_check knows the session was wrapped. ──
  await audit("wrap_auto", "session_wrapped", input.summary, {
    entity_id: input.entity_id,
    before: null,
    after: { applied, staged, pending_id: pendingId, trigger: input.trigger ?? "unknown" },
    session_id: input.session_id,
    storage: ctx.storage,
  });

  const note =
    staged.length > 0
      ? `Auto-saved. ${applied.length} change(s) applied; ${staged.length} high-risk item(s) staged for review at next /start.`
      : applied.length > 0
        ? `Auto-saved. ${applied.length} change(s) applied. Nothing needs review.`
        : "Nothing to wrap — no changes captured.";

  return {
    entity_id: input.entity_id,
    applied,
    staged,
    pending_id: pendingId,
    confirmed: false,
    note,
  };
}
