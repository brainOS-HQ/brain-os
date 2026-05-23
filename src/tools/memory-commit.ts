import { Entity } from "../schemas/entity.js";
import { readJsonFile, writeJsonFile, listJsonFiles, getEntitiesDir, getDecisionsDir, getSessionsDir, assertSafeId } from "../utils/file-store.js";
import { today } from "../utils/staleness.js";
import { logDecision } from "./decision-log.js";
import { join } from "path";
import { embedSession } from "../utils/embeddings.js";
import { audit, setSessionId } from "../utils/audit.js";

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

export async function commitMemory(input: CommitInput): Promise<CommitResult> {
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
    const path = join(getEntitiesDir(), `${entityId}.json`);
    const entity = await readJsonFile<Entity>(path);
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

      await writeJsonFile(path, entity);
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
        proof_action: "Review in next session",
        review_date: todayStr,
      });
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

  const sessionPath = join(getSessionsDir(), `${sessionId}.json`);
  await writeJsonFile(sessionPath, sessionRecord);

  await audit("memory_commit", "commit", input.session_summary, {
    before: null,
    after: sessionRecord,
  });

  embedSession(sessionId, input.session_summary).catch(() => {});

  // Generate next-session hints
  const next_session_should: string[] = [];
  const entityFiles = await listJsonFiles(getEntitiesDir());
  for (const file of entityFiles) {
    const entity = await readJsonFile<Entity>(file);
    if (entity && entity.mode === "active" && entity.blocked) {
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
