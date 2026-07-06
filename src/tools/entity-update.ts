import { Entity } from "../schemas/entity.js";
import { assertSafeId } from "../utils/file-store.js";
import { calculateStaleness, today } from "../utils/staleness.js";
import { embedEntity } from "../utils/embeddings.js";
import { audit } from "../utils/audit.js";
import { syncPulseFile } from "../utils/pulse-sync.js";
import { resolveContext } from "./context-resolve.js";
import type { ToolContext } from "../storage/adapter.js";

interface EntityUpdates {
  name?: string;
  type?: string;
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
  aliases?: string[];
}

export async function updateEntity(
  entityId: string,
  updates: EntityUpdates & { context_hint?: string },
  ctx: ToolContext
): Promise<{
  entity: Entity;
  staleness: { level: string; days: number; label: string };
  changes: string[];
}> {
  assertSafeId(entityId, "entity_id");

  // Context safety check: if the agent passes the user's original message,
  // verify it actually refers to this entity before writing.
  // Prevents cross-project contamination (e.g. saving another project's context into Brain OS).
  if (updates.context_hint) {
    const resolved = await resolveContext({ user_message: updates.context_hint }, ctx);
    if (
      resolved.entity_id !== null &&
      resolved.entity_id !== entityId &&
      resolved.confidence >= 0.7
    ) {
      throw new Error(
        `Context mismatch: the message refers to "${resolved.entity_name}" (${resolved.entity_id}), ` +
        `not "${entityId}". Pass entity_id="${resolved.entity_id}" to write to the correct project, ` +
        `or omit context_hint to override.`
      );
    }
    // Remove context_hint from updates before applying — it's not a real field
    delete (updates as Record<string, unknown>).context_hint;
  }

  const existing = await ctx.storage.getEntity(entityId);

  // Upsert: create with defaults if entity doesn't exist.
  // This allows agents (e.g. ChatGPT via MCP) to create entities by name.
  const entity: Entity = existing ?? {
    id: entityId,
    name: updates.name ?? entityId,
    type: updates.type ?? "project",
    status: "active",
    mode: "active",
    momentum: "medium",
    priority: "medium",
    blocked: null,
    next_move: "",
    last_decision: null,
    evidence_of_progress: null,
    open_questions: [],
    related_entities: [],
    metadata: {},
    created_at: today(),
    last_updated: today(),
  };

  const before = { ...entity };

  if ((updates.mode === "parked" || updates.mode === "incubating") && !updates.mode_reason && !entity.mode_reason) {
    throw new Error(`mode_reason is required when setting mode to "${updates.mode}".`);
  }

  // Smart merge for existing entities — prevents agents from silently overwriting
  // richer values with generic defaults on upsert.
  const MODE_RANK:     Record<string, number> = { active: 4, incubating: 3, parked: 2, archived: 1 };
  const MOMENTUM_RANK: Record<string, number> = { high: 4, medium: 3, low: 2, stalled: 1 };
  const PRIORITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const TYPE_RANK:     Record<string, number> = { product: 3, service: 2, project: 1 };

  function shouldSkipRanking(field: string, incoming: string, current: string | undefined,
    rank: Record<string, number>): boolean {
    if (!current || !existing) return false;   // new entity — always apply
    return (rank[incoming] ?? 0) < (rank[current] ?? 0); // skip if incoming is lower rank
  }

  // Alias exclusivity: reject incoming aliases already claimed by a different entity.
  // Only checks aliases that are genuinely new to this entity (existing ones are fine).
  if (updates.aliases && updates.aliases.length > 0) {
    const ownAliases = new Set((entity.aliases ?? []).map((a: string) => a.toLowerCase().trim()));
    const incomingNew = updates.aliases.filter(
      (a: string) => !ownAliases.has(a.toLowerCase().trim())
    );
    if (incomingNew.length > 0) {
      const allEntities = await ctx.storage.listEntities();
      const conflicts: string[] = [];
      for (const alias of incomingNew) {
        const norm = alias.toLowerCase().trim();
        for (const other of allEntities) {
          if (other.id === entityId) continue;
          if ((other.aliases ?? []).map((a: string) => a.toLowerCase().trim()).includes(norm)) {
            conflicts.push(`"${alias}" is already claimed by "${other.name}" (${other.id})`);
          }
        }
      }
      if (conflicts.length > 0) {
        throw new Error(
          `Alias conflict — cannot write:\n  ${conflicts.join("\n  ")}\n` +
          `Remove the conflicting alias(es) before updating, or rename the other entity first.`
        );
      }
    }
  }

  const changes: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    const oldValue = (entity as unknown as Record<string, unknown>)[key];

    // Ranking fields: never silently downgrade on existing entities — but make
    // the skip VISIBLE. A caller that asked for a downgrade is told it was kept,
    // so it cannot mistake a guarded no-op for an applied change.
    if (key === "mode" && shouldSkipRanking("mode", value as string, entity.mode, MODE_RANK)) {
      changes.push(`mode: kept "${entity.mode}" (ignored lower-rank "${value}")`); continue;
    }
    if (key === "momentum" && shouldSkipRanking("momentum", value as string, entity.momentum, MOMENTUM_RANK)) {
      changes.push(`momentum: kept "${entity.momentum}" (ignored lower-rank "${value}")`); continue;
    }
    if (key === "priority" && shouldSkipRanking("priority", value as string, entity.priority, PRIORITY_RANK)) {
      changes.push(`priority: kept "${entity.priority}" (ignored lower-rank "${value}")`); continue;
    }
    if (key === "type" && shouldSkipRanking("type", value as string, entity.type, TYPE_RANK)) {
      changes.push(`type: kept "${entity.type}" (ignored lower-rank "${value}")`); continue;
    }

    // status: apply any change. A genuinely identical value is a true no-op; a
    // DIFFERENT value, even a shorter one, must apply. The old "keep the
    // longer, more-specific status" heuristic silently dropped legitimate
    // shorter updates from authorized local callers.
    if (key === "status" && value === entity.status) continue;

    // evidence_of_progress: append to existing, never replace
    if (key === "evidence_of_progress" && existing && entity.evidence_of_progress &&
        value && (value as string) !== entity.evidence_of_progress) {
      const appended = `${entity.evidence_of_progress} | ${value as string}`;
      (entity as unknown as Record<string, unknown>)[key] = appended;
      changes.push(`${key}: appended new evidence`);
      continue;
    }

    // open_questions: deduplicated union merge
    // Before adding a new question, check if it's semantically close to an existing one
    // (50%+ word overlap = duplicate). Multi-source confirmation: if two AI tools both
    // surface the same idea, tag it as confirmed rather than duplicating it.
    if (key === "open_questions" && existing && Array.isArray(value)) {
      const current = (entity.open_questions ?? []) as string[];
      const stopWords = new Set(["the","a","an","is","it","in","of","to","and","or","for","on","with","that","this","are","was","be","as","at","by","do","how","what","should","could","would","we","our","your"]);
      const words = (s: string) => s.toLowerCase().split(/\W+/).filter(w => w.length > 3 && !stopWords.has(w));
      const overlapRatio = (a: string, b: string): number => {
        const wa = new Set(words(a));
        const wb = words(b);
        if (wa.size === 0 || wb.length === 0) return 0;
        const overlap = wb.filter(w => wa.has(w)).length;
        return overlap / Math.max(wa.size, wb.length);
      };

      let added = 0;
      let confirmed = 0;
      let skipped = 0;
      const result = [...current];

      for (const incoming of value as string[]) {
        const duplicate = current.find(q => overlapRatio(incoming, q) >= 0.5);
        if (duplicate) {
          // Two sources converged on the same idea — tag it as multi-source confirmed
          const idx = result.indexOf(duplicate);
          if (idx >= 0 && !result[idx].includes("[confirmed]")) {
            result[idx] = `[confirmed by multiple sources] ${result[idx]}`;
            confirmed++;
          }
          skipped++;
        } else {
          result.push(incoming);
          added++;
        }
      }

      entity.open_questions = [...new Set(result)];
      if (added > 0 || confirmed > 0) {
        const parts: string[] = [];
        if (added > 0) parts.push(`${added} new`);
        if (confirmed > 0) parts.push(`${confirmed} confirmed by multiple sources`);
        if (skipped > 0) parts.push(`${skipped} duplicate(s) skipped`);
        changes.push(`open_questions: ${parts.join(", ")} (${entity.open_questions.length} total)`);
      }
      continue;
    }

    // related_entities + aliases: plain union merge (no dedup heuristic needed)
    if (["related_entities", "aliases"].includes(key) &&
        existing && Array.isArray(value)) {
      const current = (entity as unknown as Record<string, unknown>)[key] as string[] ?? [];
      const merged = [...new Set([...current, ...(value as string[])])];
      (entity as unknown as Record<string, unknown>)[key] = merged;
      const added = merged.length - current.length;
      if (added > 0) {
        changes.push(`${key}: merged ${added} new item(s) (${merged.length} total)`);
      }
      continue;
    }

    (entity as unknown as Record<string, unknown>)[key] = value;
    changes.push(`${key}: ${JSON.stringify(oldValue)} → ${JSON.stringify(value)}`);
  }

  entity.last_updated = today();
  const staleness = calculateStaleness(entity.last_updated);

  await ctx.storage.putEntity(entityId, entity);

  await audit("entity_update", "update", changes.join("; "), {
    entity_id: entityId,
    before,
    after: entity,
    storage: ctx.storage,
  });

  embedEntity(entityId, entity as unknown as Record<string, unknown>).catch(() => {});

  await syncPulseFile(entity);

  return { entity, staleness, changes };
}
