// D1StorageAdapter — implements StorageAdapter against Cloudflare D1.
// D1Database typed as `any` to avoid @cloudflare/workers-types as a hard
// npm package dependency; cast happens at the Worker boundary.

import type { StorageAdapter } from "./adapter.js";
import type { Entity } from "../schemas/entity.js";
import type { Decision } from "../schemas/decision.js";
import type { Pattern } from "../schemas/pattern.js";
import type { AuditEntry } from "../utils/audit.js";

export class D1StorageAdapter implements StorageAdapter {
  constructor(
    private readonly db: any, // D1Database
    private readonly userId: string,
    private readonly source?: string // "chatgpt" | "claude" | "cursor" | "api" | undefined
  ) {}

  // --- Entities ---

  async getEntity(id: string): Promise<Entity | null> {
    const row = (await this.db
      .prepare("SELECT data FROM entities WHERE user_id = ? AND entity_id = ?")
      .bind(this.userId, id)
      .first()) as { data: string } | null;
    return row ? JSON.parse(row.data) : null;
  }

  async putEntity(id: string, data: Entity): Promise<void> {
    // Tag the entity with the source so the memory viewer can show
    // which AI tool contributed what (chatgpt/claude/cursor/api).
    const tagged = this.source ? {
      ...data,
      metadata: {
        ...(data.metadata ?? {}),
        last_written_by: this.source,
        sources: {
          ...((data.metadata?.sources as Record<string, string>) ?? {}),
          [this.source]: new Date().toISOString(),
        },
      },
    } : data;

    await this.db
      .prepare(
        `INSERT INTO entities (user_id, entity_id, data, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, entity_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
      )
      .bind(this.userId, id, JSON.stringify(tagged), new Date().toISOString())
      .run();

    const ftsContent = [
      data.name ?? "",
      data.status ?? "",
      data.next_move ?? "",
      (data.open_questions ?? []).join(" "),
      data.last_decision ?? "",
      data.evidence_of_progress ?? "",
    ].join(" ").slice(0, 4000);

    await this.db
      .prepare("INSERT OR REPLACE INTO entities_fts (entity_id, user_id, content) VALUES (?, ?, ?)")
      .bind(id, this.userId, ftsContent)
      .run();
  }

  async listEntities(): Promise<Entity[]> {
    const result = (await this.db
      .prepare(
        "SELECT data FROM entities WHERE user_id = ? ORDER BY updated_at DESC"
      )
      .bind(this.userId)
      .all()) as { results: { data: string }[] };
    return (result.results ?? []).map((r: { data: string }) =>
      JSON.parse(r.data)
    );
  }

  // --- Decisions ---

  async getDecisions(entityId?: string): Promise<Decision[]> {
    if (entityId) {
      const result = (await this.db
        .prepare(
          "SELECT data FROM decisions WHERE user_id = ? AND entity_id = ? ORDER BY updated_at ASC"
        )
        .bind(this.userId, entityId)
        .all()) as { results: { data: string }[] };
      return (result.results ?? []).map((r: { data: string }) => JSON.parse(r.data));
    }
    const result = (await this.db
      .prepare(
        "SELECT data FROM decisions WHERE user_id = ? ORDER BY entity_id, updated_at ASC"
      )
      .bind(this.userId)
      .all()) as { results: { data: string }[] };
    return (result.results ?? []).map((r: { data: string }) => JSON.parse(r.data));
  }

  async putDecisions(entityId: string, data: Decision[]): Promise<void> {
    const now = new Date().toISOString();

    // Delete existing rows for this entity so removed decisions don't linger
    const stmts: any[] = [
      this.db.prepare("DELETE FROM decisions WHERE user_id = ? AND entity_id = ?").bind(this.userId, entityId),
      this.db.prepare("DELETE FROM decisions_fts WHERE user_id = ? AND entity_id = ?").bind(this.userId, entityId),
    ];

    for (const decision of data) {
      const decId = (decision as any).id ?? `${entityId}:${now}`;
      const ftsContent = [
        decision.decision ?? "",
        decision.why ?? "",
        (decision as any).chosen_direction ?? "",
        (decision as any).proof_action ?? "",
      ].join(" ").slice(0, 4000);

      stmts.push(
        this.db
          .prepare(
            `INSERT INTO decisions (user_id, entity_id, decision_id, data, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (user_id, entity_id, decision_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
          )
          .bind(this.userId, entityId, decId, JSON.stringify(decision), now)
      );
      stmts.push(
        this.db
          .prepare("INSERT OR REPLACE INTO decisions_fts (decision_id, user_id, entity_id, content) VALUES (?, ?, ?, ?)")
          .bind(decId, this.userId, entityId, ftsContent)
      );
    }

    // D1 batch is capped at 100 statements; chunk if needed
    for (let i = 0; i < stmts.length; i += 100) {
      await this.db.batch(stmts.slice(i, i + 100));
    }
  }

  // --- Patterns ---

  async getPatterns(): Promise<Pattern[]> {
    const row = (await this.db
      .prepare("SELECT data FROM patterns WHERE user_id = ?")
      .bind(this.userId)
      .first()) as { data: string } | null;
    return row ? JSON.parse(row.data) : [];
  }

  async putPatterns(data: Pattern[]): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO patterns (user_id, data, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
      )
      .bind(this.userId, JSON.stringify(data), new Date().toISOString())
      .run();
  }

  // --- Sessions ---

  async putSession(id: string, data: unknown): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO sessions (user_id, session_id, data, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, session_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
      )
      .bind(this.userId, id, JSON.stringify(data), new Date().toISOString())
      .run();
  }

  // --- Audit log ---

  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.db
      .prepare(
        "INSERT INTO audit_log (user_id, data, ts) VALUES (?, ?, ?)"
      )
      .bind(
        this.userId,
        JSON.stringify(entry),
        entry.timestamp ?? new Date().toISOString()
      )
      .run();
  }

  async readAuditLog(): Promise<string | null> {
    const result = (await this.db
      .prepare(
        "SELECT data FROM audit_log WHERE user_id = ? ORDER BY ts ASC"
      )
      .bind(this.userId)
      .all()) as { results: { data: string }[] };
    if (!result.results?.length) return null;
    return result.results
      .map((r: { data: string }) => r.data)
      .join("\n");
  }
}
