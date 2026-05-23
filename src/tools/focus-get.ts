import { Entity } from "../schemas/entity.js";
import { Decision } from "../schemas/decision.js";
import { Pattern } from "../schemas/pattern.js";
import { readJsonFile, listJsonFiles, getEntitiesDir, getDecisionsDir, getPatternsDir } from "../utils/file-store.js";
import { calculateStaleness, today } from "../utils/staleness.js";

interface FocusItem {
  entity_id: string;
  entity_name: string;
  score: number;
  reasons: string[];
  next_move: string;
  evidence: string[];
}

interface FocusResult {
  priorities: FocusItem[];
  do_not_do: string[];
  staleness_alerts: string[];
  unreviewed_decisions: Array<{ entity_id: string; decision: string; review_date: string }>;
  constraints_applied: string | null;
}

export async function getFocus(
  constraints?: string,
  maxResults?: number,
  options?: { suppress_default_guidance?: boolean },
): Promise<FocusResult> {
  const max = maxResults || 3;
  // Allow callers (or env) to suppress the built-in "Do not …" lines.
  // Env var is the escape hatch for embedded consumers (EVA, custom voices).
  const suppressDefaults =
    options?.suppress_default_guidance === true ||
    process.env.BRAIN_FOCUS_OMIT_DEFAULT_GUIDANCE === "1";
  // Local date string in the user's timezone, e.g. "2026-05-23".
  // Avoid `new Date(d.review_date) <= new Date()` because parsing
  // "YYYY-MM-DD" coerces to UTC midnight, which fires the overdue flag
  // hours early or late depending on the local timezone offset.
  const todayStr = today();

  const entityFiles = await listJsonFiles(getEntitiesDir());
  const entities: Entity[] = [];
  for (const file of entityFiles) {
    const e = await readJsonFile<Entity>(file);
    if (e && (e.mode === "active" || e.mode === "incubating")) {
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

  const scored: FocusItem[] = [];
  const staleness_alerts: string[] = [];
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

  const unreviewed_decisions = allDecisions
    .filter((d) => d.status === "active" && d.review_date <= todayStr)
    .map((d) => ({
      entity_id: d.entity_id,
      decision: d.decision,
      review_date: d.review_date,
    }));

  return {
    priorities,
    do_not_do,
    staleness_alerts,
    unreviewed_decisions,
    constraints_applied: constraints || null,
  };
}
