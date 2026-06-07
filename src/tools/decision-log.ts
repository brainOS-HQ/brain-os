import { Decision } from "../schemas/decision.js";
import { assertSafeId } from "../utils/file-store.js";
import { today } from "../utils/staleness.js";
import { Entity } from "../schemas/entity.js";
import { embedDecision } from "../utils/embeddings.js";
import { audit } from "../utils/audit.js";
import type { ToolContext } from "../storage/adapter.js";

interface DecisionInput {
  entity_id: string;
  decision: string;
  type?: Decision["type"];
  why: string;
  alternatives?: Array<{ option: string; rejected_because: string }>;
  chosen_direction?: string;
  assumptions?: string[];
  invalidate_if?: string[];
  proof_action?: string;
  review_date: string;
  supersedes?: string[];
}

const PLACEHOLDER_PROOF_RE = /review (in|next|later)\b|next session|^tbd$|^n\/?a$|^revisit$/i;

function validateProofAction(proof: string): void {
  const p = proof.trim();
  if (p.length === 0 || PLACEHOLDER_PROOF_RE.test(p)) {
    throw new Error(
      `proof_action "${proof}" is a placeholder. Provide a concrete, observable action — ` +
      `e.g. "Run npm test and confirm all 41 tests pass" or "Check src/prompts.ts on next session start to verify behavior X". ` +
      `Vague values like "Review in next session" create review debt without testable outcomes.`
    );
  }
}

// Generate a decision id that won't collide under concurrent decision_log
// calls from multiple MCP clients. Old `dec-NNN` sequential format is only
// used when no decisions exist yet (keeps the first few readable). Once
// any decision exists, switch to a timestamp+random suffix so two clients
// reading the same length(=5) array won't both emit `dec-006`.
function nextDecisionId(existing: Decision[]): string {
  if (existing.length === 0) return "dec-001";
  // Hex timestamp keeps the prefix short and roughly sortable. Random
  // suffix prevents same-ms collision. 36-bit timestamp + 16-bit random
  // → at one call per ms, P(collision) is ~1/65k per parallel pair.
  const ts = Date.now().toString(36);
  for (let attempt = 0; attempt < 8; attempt++) {
    const rand = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
    const id = `dec-${ts}-${rand}`;
    if (!existing.some((d) => d.id === id)) return id;
  }
  // Pathological: 8 random suffixes all collided in the same ms. Fall back
  // to a longer random tail. Effectively unreachable but defensive.
  return `dec-${ts}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function logDecision(input: DecisionInput, ctx: ToolContext): Promise<{
  logged: Decision;
  superseded: string[];
  entity_updated: boolean;
}> {
  assertSafeId(input.entity_id, "entity_id");
  if (input.proof_action !== undefined) validateProofAction(input.proof_action);
  if (input.supersedes) {
    for (const sid of input.supersedes) assertSafeId(sid, "supersedes id");
  }
  // Load all decisions for collision-safe id generation, and the entity slice for mutation.
  const allDecisions = await ctx.storage.getDecisions();
  const existing = await ctx.storage.getDecisions(input.entity_id);

  const id = nextDecisionId(allDecisions);

  const decision: Decision = {
    id,
    date: today(),
    entity_id: input.entity_id,
    type: input.type,
    decision: input.decision,
    why: input.why,
    alternatives: input.alternatives,
    chosen_direction: input.chosen_direction,
    assumptions: input.assumptions,
    invalidate_if: input.invalidate_if,
    proof_action: input.proof_action,
    review_date: input.review_date,
    status: "active",
    superseded_by: null,
  };

  const superseded: string[] = [];
  if (input.supersedes && input.supersedes.length > 0) {
    for (const targetId of input.supersedes) {
      const target = allDecisions.find((d) => d.id === targetId);
      if (!target) {
        throw new Error(`Cannot supersede ${targetId}: decision not found.`);
      }
      if (target.entity_id !== input.entity_id) {
        throw new Error(
          `Cannot supersede ${targetId}: belongs to entity "${target.entity_id}", not "${input.entity_id}". A decision can only supersede decisions of the same entity.`
        );
      }
      target.status = "superseded";
      target.superseded_by = id;
      superseded.push(target.id);
    }
  }

  existing.push(decision);
  await ctx.storage.putDecisions(input.entity_id, existing);

  await audit("decision_log", "create", `Decision: ${input.decision}`, {
    entity_id: input.entity_id,
    before: null,
    after: decision,
    storage: ctx.storage,
  });

  if (superseded.length > 0) {
    await audit("decision_log", "supersede", `Superseded: ${superseded.join(", ")}`, {
      entity_id: input.entity_id,
      before: superseded,
      after: id,
      storage: ctx.storage,
    });
  }

  let entity_updated = false;
  const entity = await ctx.storage.getEntity(input.entity_id);
  if (entity) {
    entity.last_decision = input.decision;
    entity.last_updated = today();
    await ctx.storage.putEntity(input.entity_id, entity);
    entity_updated = true;
  }

  embedDecision(id, decision as unknown as Record<string, unknown>).catch(() => {});

  return { logged: decision, superseded, entity_updated };
}
