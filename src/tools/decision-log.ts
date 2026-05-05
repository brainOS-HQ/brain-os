import { Decision } from "../schemas/decision.js";
import { readJsonFile, writeJsonFile, listJsonFiles, getDecisionsDir, getEntitiesDir } from "../utils/file-store.js";
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
}

export async function logDecision(input: DecisionInput): Promise<{
  logged: Decision;
  superseded: string[];
  entity_updated: boolean;
}> {
  const decisionsFile = join(getDecisionsDir(), "decisions.json");
  const existing = (await readJsonFile<Decision[]>(decisionsFile)) || [];

  const id = `dec-${String(existing.length + 1).padStart(3, "0")}`;

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
  if (input.type) {
    for (const d of existing) {
      if (d.entity_id === input.entity_id && d.type === input.type && d.status === "active") {
        d.status = "superseded";
        d.superseded_by = id;
        superseded.push(d.id);
      }
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
