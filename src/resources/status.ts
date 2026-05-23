import { Entity } from "../schemas/entity.js";
import { Decision } from "../schemas/decision.js";
import { Pattern } from "../schemas/pattern.js";
import { readJsonFile, listJsonFiles, getEntitiesDir, getDecisionsDir, getPatternsDir } from "../utils/file-store.js";
import { calculateStaleness, today } from "../utils/staleness.js";

export async function generateStatusBrief(): Promise<string> {
  const entityFiles = await listJsonFiles(getEntitiesDir());
  const entities: Entity[] = [];
  for (const file of entityFiles) {
    const e = await readJsonFile<Entity>(file);
    if (e) entities.push(e);
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

  const todayStr = today();

  const active = entities.filter((e) => e.mode === "active");
  const incubating = entities.filter((e) => e.mode === "incubating");
  const parked = entities.filter((e) => e.mode === "parked");
  const archived = entities.filter((e) => e.mode === "archived");

  const staleActive = active.filter((e) => {
    const s = calculateStaleness(e.last_updated);
    return s.level === "stale" || s.level === "dormant";
  });

  const blockedEntities = active.filter((e) => e.blocked);

  const fakeActive = active.filter(
    (e) => e.momentum === "stalled" && !e.blocked
  );

  const overdueDecisions = allDecisions.filter(
    (d) => d.status === "active" && d.review_date <= todayStr
  );

  const activePatterns = allPatterns.filter((p) => p.status === "active");

  // Build the top priority (simplified focus)
  let topPriority = "";
  if (active.length > 0) {
    const scored = active.map((e) => {
      const staleness = calculateStaleness(e.last_updated);
      let score = 0;
      const priorityScores: Record<string, number> = { critical: 40, high: 30, medium: 15, low: 5 };
      const momentumScores: Record<string, number> = { high: 25, medium: 15, low: 5, stalled: -5 };
      score += priorityScores[e.priority] || 0;
      score += momentumScores[e.momentum] || 0;
      if (staleness.level === "stale") score += 15;
      if (e.blocked) score += 10;
      return { entity: e, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    if (top) {
      topPriority = `${top.entity.name} (score ${top.score}) — ${top.entity.next_move}`;
    }
  }

  const lines: string[] = [
    "BRAIN OS — OPERATIONAL STATE",
    "═══════════════════════════════════════",
    "",
    `Entities: ${active.length} active, ${incubating.length} incubating, ${parked.length} parked, ${archived.length} archived`,
    "",
  ];

  // Alerts
  const alerts: string[] = [];
  if (staleActive.length > 0) {
    alerts.push(`STALE: ${staleActive.map((e) => `${e.name} (${calculateStaleness(e.last_updated).days}d)`).join(", ")}`);
  }
  if (blockedEntities.length > 0) {
    alerts.push(`BLOCKED: ${blockedEntities.map((e) => `${e.name} — ${e.blocked}`).join("; ")}`);
  }
  if (fakeActive.length > 0) {
    alerts.push(`FAKE PROGRESS: ${fakeActive.map((e) => e.name).join(", ")} — active but stalled with no blocker`);
  }
  if (overdueDecisions.length > 0) {
    alerts.push(`OVERDUE REVIEWS: ${overdueDecisions.map((d) => `"${d.decision}" (due ${d.review_date})`).join("; ")}`);
  }

  if (alerts.length > 0) {
    lines.push("ALERTS");
    lines.push("───────────────────────────────────────");
    for (const alert of alerts) {
      lines.push(`  ${alert}`);
    }
    lines.push("");
  }

  // Top priority
  if (topPriority) {
    lines.push("TOP PRIORITY");
    lines.push("───────────────────────────────────────");
    lines.push(`  ${topPriority}`);
    lines.push("");
  }

  // Active entities summary
  if (active.length > 0) {
    lines.push("ACTIVE ENTITIES");
    lines.push("───────────────────────────────────────");
    for (const e of active) {
      const s = calculateStaleness(e.last_updated);
      let planInfo = "";
      if (e.plan && e.plan.length > 0) {
        const done = e.plan.filter((p) => p.status === "done").length;
        const total = e.plan.length;
        const current = e.plan.find((p) => p.status === "active");
        planInfo = ` | plan: ${done}/${total}${current ? ` → ${current.description}` : ""}`;
      }
      lines.push(`  ${e.name} | ${e.momentum} momentum | ${s.label} | ${e.blocked ? "BLOCKED" : "clear"}${planInfo}`);
    }
    lines.push("");
  }

  // Active patterns
  if (activePatterns.length > 0) {
    lines.push("ACTIVE PATTERNS");
    lines.push("───────────────────────────────────────");
    for (const p of activePatterns) {
      lines.push(`  ${p.name} — ${p.entities_affected.join(", ")}`);
    }
    lines.push("");
  }

  // Recent decisions
  const recentDecisions = allDecisions
    .filter((d) => d.status === "active")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);
  if (recentDecisions.length > 0) {
    lines.push("RECENT DECISIONS");
    lines.push("───────────────────────────────────────");
    for (const d of recentDecisions) {
      lines.push(`  [${d.date}] ${d.entity_id}: ${d.decision}`);
    }
    lines.push("");
  }

  lines.push("═══════════════════════════════════════");
  lines.push("Tools: entity_read, entity_update, decision_log, focus_get, pattern_detect, memory_check, memory_commit");
  lines.push("Call focus_get for detailed priorities. Call memory_check to assess memory quality.");

  return lines.join("\n");
}
