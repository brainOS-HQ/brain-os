import { Entity } from "../schemas/entity.js";
import { Decision } from "../schemas/decision.js";
import { Pattern } from "../schemas/pattern.js";
import { readJsonFile, writeJsonFile, listJsonFiles, getEntitiesDir, getDecisionsDir, getPatternsDir } from "../utils/file-store.js";
import { calculateStaleness } from "../utils/staleness.js";
import { join } from "path";

interface DetectedPattern {
  name: string;
  entities_affected: string[];
  evidence: string[];
  interpretation: string;
  risk: string;
  recommendation: string;
  is_new: boolean;
}

interface PatternResult {
  detected: DetectedPattern[];
  existing_patterns: Array<{ name: string; status: string; still_valid: boolean }>;
  summary: string;
}

export async function detectPatterns(scope?: string): Promise<PatternResult> {
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

  const patternFile = join(getPatternsDir(), "patterns.json");
  const existingPatterns = (await readJsonFile<Pattern[]>(patternFile)) || [];

  const detected: DetectedPattern[] = [];

  // Pattern: Shared blockers
  const blockerMap = new Map<string, string[]>();
  for (const e of entities) {
    if (e.blocked && e.mode === "active") {
      const blockerKey = e.blocked.toLowerCase().trim();
      if (!blockerMap.has(blockerKey)) blockerMap.set(blockerKey, []);
      blockerMap.get(blockerKey)!.push(e.id);
    }
  }
  for (const [blocker, entityIds] of blockerMap) {
    if (entityIds.length > 1) {
      detected.push({
        name: "Shared blocker across entities",
        entities_affected: entityIds,
        evidence: [`Same blocker in ${entityIds.length} entities: "${blocker}"`],
        interpretation: "Multiple entities are stuck on the same problem. Solving it once unblocks all of them.",
        risk: "Each entity treats this as separate, wasting effort on duplicate unblocking.",
        recommendation: `Resolve the shared blocker "${blocker}" once for all affected entities.`,
        is_new: true,
      });
    }
  }

  // Pattern: Active but stalled (fake progress)
  const fakeActive = entities.filter(
    (e) => e.mode === "active" && e.momentum === "stalled" && !e.blocked
  );
  if (fakeActive.length > 0) {
    detected.push({
      name: "Fake-active entities",
      entities_affected: fakeActive.map((e) => e.id),
      evidence: fakeActive.map((e) => `${e.name}: mode=active, momentum=stalled, no blocker`),
      interpretation: "These entities are marked active but not actually moving. No blocker is listed, so the real issue is attention or priority.",
      risk: "Creates illusion of progress. Mental load without output.",
      recommendation: "For each: either ship something this week or explicitly park it.",
      is_new: true,
    });
  }

  // Pattern: Stale active entities
  const staleActive = entities.filter((e) => {
    if (e.mode !== "active") return false;
    const s = calculateStaleness(e.last_updated);
    return s.level === "stale" || s.level === "dormant";
  });
  if (staleActive.length > 0) {
    detected.push({
      name: "Stale active entities",
      entities_affected: staleActive.map((e) => e.id),
      evidence: staleActive.map((e) => {
        const s = calculateStaleness(e.last_updated);
        return `${e.name}: last updated ${e.last_updated} (${s.days} days ago)`;
      }),
      interpretation: "Active entities that haven't been touched in weeks. Either work is happening without updates, or these are quietly abandoned.",
      risk: "Context decays. Decisions get forgotten. Restarting becomes harder the longer they sit.",
      recommendation: "Update each pulse or change mode to parked.",
      is_new: true,
    });
  }

  // Pattern: Related entities that could share work
  const relatedGroups = new Map<string, Set<string>>();
  for (const e of entities) {
    for (const related of e.related_entities) {
      const key = [e.id, related].sort().join("--");
      if (!relatedGroups.has(key)) relatedGroups.set(key, new Set());
      relatedGroups.get(key)!.add(e.id);
      relatedGroups.get(key)!.add(related);
    }
  }

  // Pattern: Decision type concentration
  const decisionsByType = new Map<string, number>();
  for (const d of allDecisions.filter((d) => d.status === "active" && d.type)) {
    decisionsByType.set(d.type!, (decisionsByType.get(d.type!) || 0) + 1);
  }

  // Check existing patterns
  const existing_patterns = existingPatterns.map((p) => {
    const affectedEntities = entities.filter((e) => p.entities_affected.includes(e.id));
    const still_valid = affectedEntities.length > 0;
    return { name: p.name, status: p.status, still_valid };
  });

  const totalEntities = entities.length;
  const activeCount = entities.filter((e) => e.mode === "active").length;
  const summary = `Scanned ${totalEntities} entities (${activeCount} active). Found ${detected.length} patterns. ${existingPatterns.length} existing patterns reviewed.`;

  return { detected, existing_patterns, summary };
}
