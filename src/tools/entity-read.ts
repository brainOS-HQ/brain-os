import { Entity, EntitySummary } from "../schemas/entity.js";
import { readJsonFile, listJsonFiles, getEntitiesDir, getDecisionsDir, assertSafeId } from "../utils/file-store.js";
import { calculateStaleness, today } from "../utils/staleness.js";
import { Decision } from "../schemas/decision.js";

export async function readEntity(entityId: string): Promise<{
  entity: Entity;
  staleness: { level: string; days: number; label: string };
  recent_decisions: Decision[];
  alerts: string[];
}> {
  assertSafeId(entityId, "entity_id");
  const path = `${getEntitiesDir()}/${entityId}.json`;
  const entity = await readJsonFile<Entity>(path);

  if (!entity) {
    throw new Error(`Entity "${entityId}" not found. Available entities can be listed with entity_read (no arguments).`);
  }

  const staleness = calculateStaleness(entity.last_updated);

  const decisionFiles = await listJsonFiles(getDecisionsDir());
  const allDecisions: Decision[] = [];
  for (const file of decisionFiles) {
    const data = await readJsonFile<Decision[]>(file);
    if (data) allDecisions.push(...data);
  }
  const recent_decisions = allDecisions
    .filter((d) => d.entity_id === entityId && d.status === "active")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  const alerts: string[] = [];
  if (entity.mode === "active" && staleness.level === "stale") {
    alerts.push(`STALE: Active entity not updated in ${staleness.days} days. Should this be parked or reactivated?`);
  }
  if (entity.mode === "active" && staleness.level === "dormant") {
    alerts.push(`DORMANT: Active entity not updated in ${staleness.days} days. This is likely abandoned — decide: park or reactivate.`);
  }
  if (entity.mode === "active" && entity.momentum === "stalled") {
    alerts.push("STALLED: Marked active but momentum is stalled. Is this real progress or fake-active?");
  }
  if (entity.blocked) {
    alerts.push(`BLOCKED: ${entity.blocked}`);
  }

  // String compare avoids UTC-vs-local Date parsing drift; today() returns
  // local-tz YYYY-MM-DD, review_date is the same format, both zero-padded.
  const todayStr = today();
  const unreviewedDecisions = recent_decisions.filter((d) => d.review_date <= todayStr);
  for (const d of unreviewedDecisions) {
    alerts.push(`DECISION REVIEW DUE: "${d.decision}" — review was due ${d.review_date}`);
  }

  return { entity, staleness, recent_decisions, alerts };
}

export async function readAllEntities(): Promise<{
  entities: EntitySummary[];
  alerts: string[];
  total: { active: number; parked: number; incubating: number; archived: number };
}> {
  const files = await listJsonFiles(getEntitiesDir());
  const entities: EntitySummary[] = [];
  const alerts: string[] = [];
  const total = { active: 0, parked: 0, incubating: 0, archived: 0 };

  for (const file of files) {
    const entity = await readJsonFile<Entity>(file);
    if (!entity) continue;

    const staleness = calculateStaleness(entity.last_updated);
    total[entity.mode]++;

    entities.push({
      id: entity.id,
      name: entity.name,
      type: entity.type,
      mode: entity.mode,
      momentum: entity.momentum,
      priority: entity.priority,
      blocked: entity.blocked,
      next_move: entity.next_move,
      staleness: staleness.label,
      last_updated: entity.last_updated,
    });

    if (entity.mode === "active" && (staleness.level === "stale" || staleness.level === "dormant")) {
      alerts.push(`${entity.name}: ${staleness.label} — should this be parked?`);
    }
    if (entity.mode === "active" && entity.momentum === "stalled" && !entity.blocked) {
      alerts.push(`${entity.name}: Active but stalled with no blocker — fake progress?`);
    }
  }

  entities.sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const modeOrder = { active: 0, incubating: 1, parked: 2, archived: 3 };
    const modeDiff = (modeOrder[a.mode as keyof typeof modeOrder] ?? 4) - (modeOrder[b.mode as keyof typeof modeOrder] ?? 4);
    if (modeDiff !== 0) return modeDiff;
    return (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 4) - (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 4);
  });

  return { entities, alerts, total };
}
