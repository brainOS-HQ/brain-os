import { Decision } from "../schemas/decision.js";
import { readJsonFile, writeJsonFile, listJsonFiles, getDecisionsDir, getEntitiesDir, assertSafeId } from "../utils/file-store.js";
import { today } from "../utils/staleness.js";
import { Entity } from "../schemas/entity.js";
import { join } from "path";
import { embedDecision } from "../utils/embeddings.js";
import { audit } from "../utils/audit.js";

interface DecisionInput {
  entity_id: string;
  decision: string;
  type?: Decision["type"];
  why: string;
  alternatives?: Array<{ option: string; rejected_because: string }>;
  chosen_direction?: string;
  proof_action: string;
  review_date: string;
  supersedes?: string[];
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

export async function logDecision(input: DecisionInput): Promise<{
  logged: Decision;
  superseded: string[];
  entity_updated: boolean;
}> {
  assertSafeId(input.entity_id, "entity_id");
  if (input.supersedes) {
    for (const sid of input.supersedes) assertSafeId(sid, "supersedes id");
  }
  const decisionsFile = join(getDecisionsDir(), "decisions.json");
  const existing = (await readJsonFile<Decision[]>(decisionsFile)) || [];

  const id = nextDecisionId(existing);

  const decision: Decision = {
    id,
    date: today(),
    entity_id: input.entity_id,
    type: input.type,
    decision: input.decision,
    why: input.why,
    alternatives: input.alternatives,
    chosen_direction: input.chosen_direction,
    proof_action: input.proof_action,
    review_date: input.review_date,
    status: "active",
    superseded_by: null,
  };

  const superseded: string[] = [];
  if (input.supersedes && input.supersedes.length > 0) {
    for (const targetId of input.supersedes) {
      const target = existing.find((d) => d.id === targetId);
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
  await writeJsonFile(decisionsFile, existing);

  await audit("decision_log", "create", `Decision: ${input.decision}`, {
    entity_id: input.entity_id,
    before: null,
    after: decision,
  });

  if (superseded.length > 0) {
    await audit("decision_log", "supersede", `Superseded: ${superseded.join(", ")}`, {
      entity_id: input.entity_id,
      before: superseded,
      after: id,
    });
  }

  let entity_updated = false;
  const entityPath = join(getEntitiesDir(), `${input.entity_id}.json`);
  const entity = await readJsonFile<Entity>(entityPath);
  if (entity) {
    entity.last_decision = input.decision;
    entity.last_updated = today();
    await writeJsonFile(entityPath, entity);
    entity_updated = true;
  }

  embedDecision(id, decision as unknown as Record<string, unknown>).catch(() => {});

  return { logged: decision, superseded, entity_updated };
}
