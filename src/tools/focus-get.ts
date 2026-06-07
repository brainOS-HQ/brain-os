import { Entity } from "../schemas/entity.js";
import { Decision } from "../schemas/decision.js";
import { Pattern } from "../schemas/pattern.js";
import { calculateStaleness, today } from "../utils/staleness.js";
import type { ToolContext } from "../storage/adapter.js";
interface FocusItem {
  entity_id: string;
  entity_name: string;
  score: number;
  reasons: string[];
  next_move: string;
  evidence: string[];
}

interface FollowThroughAlert {
  entity_id: string;
  entity_name: string;
  next_move: string;
  days_since_update: number;
}

interface FocusResult {
  scope: string;
  priorities: FocusItem[];
  do_not_do: string[];
  staleness_alerts: string[];
  // Entities that stated a next_move but haven't logged any update in 7+ days.
  // Surfaced as a first-class alert — same tier as blockers — so promises don't
  // silently expire. Only fires for active, unblocked entities.
  follow_through_alerts: FollowThroughAlert[];
  unreviewed_decisions: Array<{ entity_id: string; decision: string; review_date: string }>;
  review_debt: { count: number; hint: string } | null;
  constraints_applied: string | null;
}

export async function getFocus(
  ctx: ToolContext,
  constraints?: string,
  maxResults?: number,
  options?: { suppress_default_guidance?: boolean; entity_id?: string },
): Promise<FocusResult> {
  const max = maxResults || 3;
  const suppressDefaults =
    options?.suppress_default_guidance === true ||
    process.env.BRAIN_FOCUS_OMIT_DEFAULT_GUIDANCE === "1";
  const todayStr = today();

  const allEntitiesRaw = await ctx.storage.listEntities();
  const allEntities: Entity[] = allEntitiesRaw;
  const allActiveEntities: Entity[] = allEntitiesRaw.filter(
    (e) => e.mode === "active" || e.mode === "incubating"
  );
  const scopedEntityId = options?.entity_id;

  let entities: Entity[];
  let scope: string;
  if (scopedEntityId) {
    const target = allActiveEntities.find((e) => e.id === scopedEntityId);
    if (!target) {
      const parked = allEntities.find((e) => e.id === scopedEntityId) ?? null;
      if (parked) {
        scope = `${parked.name} (${parked.mode})`;
        return {
          scope,
          priorities: [],
          do_not_do: [`${parked.name} is ${parked.mode}${parked.mode_reason ? ` — ${parked.mode_reason}` : ""}`],
          staleness_alerts: [],
          follow_through_alerts: [],
          unreviewed_decisions: [],
          review_debt: null,
          constraints_applied: constraints || null,
        };
      }
      scope = `unknown entity: ${scopedEntityId}`;
      return {
        scope,
        priorities: [],
        do_not_do: [],
        staleness_alerts: [],
        follow_through_alerts: [],
        unreviewed_decisions: [],
        review_debt: null,
        constraints_applied: constraints || null,
      };
    }
    entities = [target];
    scope = target.name;
  } else {
    entities = allActiveEntities;
    scope = "global";
  }

  const allDecisions: Decision[] = await ctx.storage.getDecisions();

  const allPatterns: Pattern[] = await ctx.storage.getPatterns();

  const FOLLOW_THROUGH_DAYS = 7;
  const scored: FocusItem[] = [];
  const staleness_alerts: string[] = [];
  const follow_through_alerts: FollowThroughAlert[] = [];
  const do_not_do: string[] = [];

  for (const entity of entities) {
    const staleness = calculateStaleness(entity.last_updated);
    let score = 0;
    const reasons: string[] = [];
    const evidence: string[] = [];

    const priorityScores = { critical: 40, high: 30, medium: 15, low: 5 };
    score += priorityScores[entity.priority] ?? 0;
    if (entity.priority === "critical" || entity.priority === "high") {
      reasons.push(`Priority: ${entity.priority}`);
    }

    const momentumScores = { high: 25, medium: 15, low: 5, stalled: -5 };
    score += momentumScores[entity.momentum] ?? 0;
    if (entity.momentum === "high") {
      reasons.push("Has momentum — ride the wave");
      evidence.push(`Momentum is ${entity.momentum}`);
    }

    if (staleness.level === "stale" && entity.mode === "active") {
      score += 15;
      reasons.push("Stale — needs attention or explicit park");
      staleness_alerts.push(`${entity.name}: ${staleness.label}`);
    } else if (staleness.level === "dormant" && entity.mode === "active") {
      score += 10;
      staleness_alerts.push(`${entity.name}: ${staleness.label} — decide: park or reactivate`);
    }

    if (entity.blocked) {
      score += 10;
      reasons.push(`Blocked: ${entity.blocked}`);
    }

    // Follow-through: active entity stated a next_move but hasn't logged any
    // progress update in 7+ days. Not triggered when blocked (the stall is
    // intentional) or when incubating (lower-cadence by design).
    if (
      entity.next_move &&
      entity.mode === "active" &&
      !entity.blocked &&
      staleness.days >= FOLLOW_THROUGH_DAYS
    ) {
      score += 12;
      reasons.push(`Next move stated ${staleness.days}d ago — no progress logged since`);
      follow_through_alerts.push({
        entity_id: entity.id,
        entity_name: entity.name,
        next_move: entity.next_move,
        days_since_update: staleness.days,
      });
    }

    const relatedActiveCount = entities.filter(
      (e) => entity.related_entities.includes(e.id) && e.mode === "active"
    ).length;
    if (relatedActiveCount > 0) {
      score += relatedActiveCount * 5;
      reasons.push(`Unlocks ${relatedActiveCount} other active entities`);
    }

    const entityDecisions = allDecisions.filter(
      (d) => d.entity_id === entity.id && d.status === "active"
    );
    const overdueProofs = entityDecisions.filter(
      (d) => d.review_date <= todayStr
    );
    if (overdueProofs.length > 0) {
      score += 10;
      reasons.push(`${overdueProofs.length} decision(s) due for review`);
      for (const d of overdueProofs) {
        evidence.push(`Decision "${d.decision}" — review due ${d.review_date}`);
      }
    }

    if (entity.evidence_of_progress) {
      evidence.push(`Recent progress: ${entity.evidence_of_progress}`);
    }

    if (entity.mode === "incubating") {
      score = Math.floor(score * 0.6);
    }

    scored.push({
      entity_id: entity.id,
      entity_name: entity.name,
      score,
      reasons,
      next_move: entity.next_move,
      evidence,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const priorities = scored.slice(0, max);
  const deprioritized = scored.slice(max);

  for (const item of deprioritized) {
    if (item.score > 0) {
      do_not_do.push(`${item.entity_name} — not today (score: ${item.score})`);
    }
  }

  if (!suppressDefaults) {
    do_not_do.push("Do not reorganize files or restructure projects");
    do_not_do.push("Do not start new ideas — finish what's in progress");
  }

  const scopedEntityIds = new Set(entities.map((e) => e.id));
  const unreviewed_decisions = allDecisions
    .filter((d) => d.status === "active" && d.review_date <= todayStr && scopedEntityIds.has(d.entity_id))
    .map((d) => ({
      entity_id: d.entity_id,
      decision: d.decision,
      review_date: d.review_date,
    }));

  const review_debt =
    unreviewed_decisions.length > 0
      ? {
          count: unreviewed_decisions.length,
          hint: `${unreviewed_decisions.length} decision(s) due for review → run /reconcile`,
        }
      : null;

  return {
    scope,
    priorities,
    do_not_do,
    staleness_alerts,
    follow_through_alerts,
    unreviewed_decisions,
    review_debt,
    constraints_applied: constraints || null,
  };
}
