import { Entity } from "../schemas/entity.js";
import { Decision } from "../schemas/decision.js";
import { Pattern } from "../schemas/pattern.js";
import { readJsonFile, listJsonFiles, getEntitiesDir, getDecisionsDir, getPatternsDir } from "../utils/file-store.js";
import { calculateStaleness, today } from "../utils/staleness.js";

interface SignalItem {
  entity_id: string;
  entity_name: string;
  detail: string;
}

interface MemoryCheckResult {
  signal_quality: {
    strong: SignalItem[];
    weak: SignalItem[];
    noise: SignalItem[];
    dangerous: SignalItem[];
  };
  contradictions: string[];
  overdue_reviews: Array<{ decision_id: string; entity_id: string; decision: string; review_date: string }>;
  stale_next_moves: Array<{ entity_id: string; entity_name: string; next_move: string; days_unchanged: number }>;
  recommended_cleanup: string[];
  summary: string;
}

export async function checkMemory(entityId?: string): Promise<MemoryCheckResult> {
  const entityFiles = await listJsonFiles(getEntitiesDir());
  const entities: Entity[] = [];
  for (const file of entityFiles) {
    const e = await readJsonFile<Entity>(file);
    if (e) {
      if (entityId && e.id !== entityId) continue;
      entities.push(e);
    }
  }

  const decisionFiles = await listJsonFiles(getDecisionsDir());
  const allDecisions: Decision[] = [];
  for (const file of decisionFiles) {
    const data = await readJsonFile<Decision[]>(file);
    if (data) allDecisions.push(...data);
  }

  const patternFiles = await listJsonFiles(getPatternsDir());
  const allPatterns: Pattern[] = [];
  for (const file of patternFiles) {
    const data = await readJsonFile<Pattern[]>(file);
    if (data) allPatterns.push(...data);
  }

  const strong: SignalItem[] = [];
  const weak: SignalItem[] = [];
  const noise: SignalItem[] = [];
  const dangerous: SignalItem[] = [];
  const contradictions: string[] = [];
  const recommended_cleanup: string[] = [];

  const todayStr = today();

  for (const entity of entities) {
    const staleness = calculateStaleness(entity.last_updated);
    const entityDecisions = allDecisions.filter((d) => d.entity_id === entity.id && d.status === "active");

    // Strong signal: fresh, has evidence, has active decisions, clear next_move
    if (
      staleness.level === "fresh" &&
      entity.evidence_of_progress &&
      entity.momentum !== "stalled" &&
      entity.next_move
    ) {
      strong.push({
        entity_id: entity.id,
        entity_name: entity.name,
        detail: `Fresh (${staleness.days}d), has evidence of progress, momentum=${entity.momentum}, clear next move`,
      });
    }
    // Dangerous: active + stale + no blocker = fake active
    else if (
      entity.mode === "active" &&
      (staleness.level === "stale" || staleness.level === "dormant") &&
      !entity.blocked
    ) {
      dangerous.push({
        entity_id: entity.id,
        entity_name: entity.name,
        detail: `Marked active but ${staleness.label} with no blocker. Likely abandoned. Park it or ship something.`,
      });
      recommended_cleanup.push(`${entity.name}: Park this entity or update with evidence of progress`);
    }
    // Dangerous: active + stalled momentum + has decisions never reviewed
    else if (
      entity.mode === "active" &&
      entity.momentum === "stalled" &&
      entityDecisions.some((d) => d.review_date <= todayStr)
    ) {
      dangerous.push({
        entity_id: entity.id,
        entity_name: entity.name,
        detail: `Active but stalled, with overdue decision reviews. Decisions may be based on outdated reasoning.`,
      });
    }
    // Weak: aging, or missing evidence, or vague next_move
    else if (
      staleness.level === "aging" ||
      !entity.evidence_of_progress ||
      entity.momentum === "low"
    ) {
      weak.push({
        entity_id: entity.id,
        entity_name: entity.name,
        detail: `${staleness.label}, ${entity.evidence_of_progress ? "has evidence" : "no evidence of progress"}, momentum=${entity.momentum}`,
      });
    }
    // Everything else is noise or neutral
    else if (entity.mode === "parked" || entity.mode === "archived") {
      // Parked/archived entities are not noise — they're intentionally quiet
    } else {
      strong.push({
        entity_id: entity.id,
        entity_name: entity.name,
        detail: `${staleness.label}, mode=${entity.mode}, momentum=${entity.momentum}`,
      });
    }

    // Contradiction: entity says blocked but a decision says the blocker was resolved
    if (entity.blocked) {
      const relatedDecisions = allDecisions.filter(
        (d) => d.entity_id === entity.id && d.status === "active"
      );
      for (const d of relatedDecisions) {
        const decisionLower = d.decision.toLowerCase();
        const blockerLower = entity.blocked.toLowerCase();
        // Simple heuristic: if the decision mentions completing/resolving something related to the blocker
        if (
          (decisionLower.includes("complete") || decisionLower.includes("resolve") || decisionLower.includes("done") || decisionLower.includes("ship")) &&
          blockerLower.split(" ").some((word) => word.length > 3 && decisionLower.includes(word))
        ) {
          contradictions.push(
            `${entity.name}: blocked on "${entity.blocked}" but decision "${d.decision}" suggests this may be resolved. Verify and clear blocker if resolved.`
          );
        }
      }
    }

    // Contradiction: entity active but all related entities are archived/parked
    if (entity.mode === "active" && entity.related_entities.length > 0) {
      const relatedEntities = entities.filter((e) => entity.related_entities.includes(e.id));
      const allRelatedInactive = relatedEntities.length > 0 && relatedEntities.every(
        (e) => e.mode === "parked" || e.mode === "archived"
      );
      if (allRelatedInactive) {
        contradictions.push(
          `${entity.name}: active, but all related entities are parked/archived. Is this still relevant?`
        );
      }
    }
  }

  // Check overdue decision reviews
  const overdue_reviews = allDecisions
    .filter((d) => d.status === "active" && d.review_date <= todayStr)
    .map((d) => ({
      decision_id: d.id,
      entity_id: d.entity_id,
      decision: d.decision,
      review_date: d.review_date,
    }));

  for (const d of overdue_reviews) {
    recommended_cleanup.push(`Decision "${d.decision}" — review was due ${d.review_date}. Reaffirm, update, or archive.`);
  }

  // Check patterns with no recent confirmation
  for (const p of allPatterns) {
    if (p.status === "active") {
      const lastConfirmed = p.last_confirmed || p.first_detected;
      const daysSinceConfirmed = Math.floor(
        (new Date(todayStr).getTime() - new Date(lastConfirmed).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSinceConfirmed > 30) {
        noise.push({
          entity_id: p.entities_affected[0] || "unknown",
          entity_name: `Pattern: ${p.name}`,
          detail: `Active pattern not confirmed in ${daysSinceConfirmed} days. May no longer be true.`,
        });
        recommended_cleanup.push(`Pattern "${p.name}" — not confirmed in ${daysSinceConfirmed} days. Re-verify or retire.`);
      }
    }
  }

  // Stale next_moves — entities where next_move hasn't resulted in progress
  const stale_next_moves = entities
    .filter(
      (e) =>
        e.mode === "active" &&
        e.next_move &&
        !e.evidence_of_progress &&
        calculateStaleness(e.last_updated).days > 14
    )
    .map((e) => ({
      entity_id: e.id,
      entity_name: e.name,
      next_move: e.next_move,
      days_unchanged: calculateStaleness(e.last_updated).days,
    }));

  const totalEntities = entities.length;
  const summary = `Checked ${totalEntities} entities, ${allDecisions.length} decisions, ${allPatterns.length} patterns. Found ${strong.length} strong signals, ${weak.length} weak, ${noise.length} noise, ${dangerous.length} dangerous. ${contradictions.length} contradictions. ${overdue_reviews.length} overdue reviews. ${recommended_cleanup.length} cleanup actions.`;

  return {
    signal_quality: { strong, weak, noise, dangerous },
    contradictions,
    overdue_reviews,
    stale_next_moves,
    recommended_cleanup,
    summary,
  };
}
