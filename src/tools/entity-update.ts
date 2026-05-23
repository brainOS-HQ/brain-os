import { Entity } from "../schemas/entity.js";
import { readJsonFile, writeJsonFile, getEntitiesDir, assertSafeId } from "../utils/file-store.js";
import { calculateStaleness, today } from "../utils/staleness.js";
import { embedEntity } from "../utils/embeddings.js";
import { audit } from "../utils/audit.js";
import { syncPulseFile } from "../utils/pulse-sync.js";

interface EntityUpdates {
  status?: string;
  mode?: "active" | "parked" | "incubating" | "archived";
  mode_reason?: string;
  momentum?: "high" | "medium" | "low" | "stalled";
  priority?: "critical" | "high" | "medium" | "low";
  blocked?: string | null;
  next_move?: string;
  last_decision?: string;
  evidence_of_progress?: string;
  open_questions?: string[];
  related_entities?: string[];
}

export async function updateEntity(
  entityId: string,
  updates: EntityUpdates
): Promise<{
  entity: Entity;
  staleness: { level: string; days: number; label: string };
  changes: string[];
}> {
  assertSafeId(entityId, "entity_id");
  const path = `${getEntitiesDir()}/${entityId}.json`;
  const entity = await readJsonFile<Entity>(path);

  if (!entity) {
    throw new Error(`Entity "${entityId}" not found.`);
  }

  const before = { ...entity };

  if ((updates.mode === "parked" || updates.mode === "incubating") && !updates.mode_reason && !entity.mode_reason) {
    throw new Error(`mode_reason is required when setting mode to "${updates.mode}".`);
  }

  const changes: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      const oldValue = (entity as unknown as Record<string, unknown>)[key];
      (entity as unknown as Record<string, unknown>)[key] = value;
      changes.push(`${key}: ${JSON.stringify(oldValue)} → ${JSON.stringify(value)}`);
    }
  }

  entity.last_updated = today();
  const staleness = calculateStaleness(entity.last_updated);

  await writeJsonFile(path, entity);

  await audit("entity_update", "update", changes.join("; "), {
    entity_id: entityId,
    before,
    after: entity,
  });

  embedEntity(entityId, entity as unknown as Record<string, unknown>).catch(() => {});

  await syncPulseFile(entity);

  return { entity, staleness, changes };
}
