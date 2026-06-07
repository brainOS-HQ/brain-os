import { Entity } from "../schemas/entity.js";
import { assertSafeId } from "../utils/file-store.js";
import { today } from "../utils/staleness.js";
import { logDecision } from "./decision-log.js";
import { embedSession } from "../utils/embeddings.js";
import { audit, setSessionId } from "../utils/audit.js";
import type { ToolContext } from "../storage/adapter.js";

interface CommitInput {
  session_summary: string;
  entities_touched: string[];
  decisions_made?: Array<{
    entity_id: string;
    decision: string;
    why: string;
  }>;
  patterns_noticed?: string[];
  momentum_changes?: Array<{
    entity_id: string;
    direction: "up" | "same" | "down" | "stalled";
  }>;
}

interface CommitResult {
  entities_updated: string[];
  decisions_logged: number;
  patterns_recorded: number;
  session_id: string;
  next_session_should: string[];
}

export async function commitMemory(input: CommitInput, ctx: ToolContext): Promise<CommitResult> {
  for (const eid of input.entities_touched) assertSafeId(eid, "entity_id");
  if (input.decisions_made) {
    for (const d of input.decisions_made) assertSafeId(d.entity_id, "entity_id");
  }
  if (input.momentum_changes) {
    for (const m of input.momentum_changes) assertSafeId(m.entity_id, "entity_id");
  }

  const todayStr = today();
  const sessionId = `session-${todayStr}-${Date.now()}`;
  setSessionId(sessionId);
  const entitiesUpdated: string[] = [];

  // Update last_updated on all touched entities
  for (const entityId of input.entities_touched) {
    const entity = await ctx.storage.getEntity(entityId);
    if (entity) {
      entity.last_updated = todayStr;

      // Apply momentum changes
      const momentumChange = input.momentum_changes?.find((m) => m.entity_id === entityId);
      if (momentumChange) {
        const momentumMap: Record<string, Entity["momentum"]> = {
          up: "high",
          same: entity.momentum,
          down: "low",
          stalled: "stalled",
        };
        entity.momentum = momentumMap[momentumChange.direction];
      }

      await ctx.storage.putEntity(entityId, entity);
      entitiesUpdated.push(entityId);
    }
  }

  // Log decisions
  let decisionsLogged = 0;
  if (input.decisions_made) {
    for (const d of input.decisions_made) {
      await logDecision({
        entity_id: d.entity_id,
        decision: d.decision,
        why: d.why,
        review_date: todayStr,
      }, ctx);
      decisionsLogged++;
    }
  }

  // Save session record
  const sessionRecord = {
    id: sessionId,
    date: todayStr,
    summary: input.session_summary,
    entities_touched: input.entities_touched,
    decisions_logged: decisionsLogged,
    patterns_noticed: input.patterns_noticed || [],
    momentum_changes: input.momentum_changes || [],
  };

  await ctx.storage.putSession(sessionId, sessionRecord);

  await audit("memory_commit", "commit", input.session_summary, {
    before: null,
    after: sessionRecord,
    storage: ctx.storage,
  });

  embedSession(sessionId, input.session_summary).catch(() => {});

  // Generate next-session hints
  const next_session_should: string[] = [];
  const allEntities = await ctx.storage.listEntities();
  for (const entity of allEntities) {
    if (entity.mode === "active" && entity.blocked) {
      next_session_should.push(`Check blocker on ${entity.name}: ${entity.blocked}`);
    }
  }
  if (input.patterns_noticed && input.patterns_noticed.length > 0) {
    next_session_should.push("Review patterns noticed this session");
  }

  return {
    entities_updated: entitiesUpdated,
    decisions_logged: decisionsLogged,
    patterns_recorded: input.patterns_noticed?.length || 0,
    session_id: sessionId,
    next_session_should,
  };
}
