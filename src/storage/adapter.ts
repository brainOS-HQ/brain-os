import type { Entity } from "../schemas/entity.js";
import type { Decision } from "../schemas/decision.js";
import type { Pattern } from "../schemas/pattern.js";
import type { AuditEntry } from "../utils/audit.js";

/**
 * StorageAdapter — abstract interface for all Brain OS persistent state I/O.
 *
 * Tools depend on this interface rather than file-store.ts directly, allowing
 * the storage backend to be swapped (local JSON files, Cloudflare KV, D1, etc.)
 * without touching tool logic.
 */
export interface StorageAdapter {
  // --- Entities ---

  /** Read a single entity by id. Returns null if not found. */
  getEntity(id: string): Promise<Entity | null>;

  /** Persist an entity (create or overwrite). */
  putEntity(id: string, data: Entity): Promise<void>;

  /** List all stored entities. */
  listEntities(): Promise<Entity[]>;

  // --- Decisions ---

  /**
   * Read decisions, optionally filtered to a single entity.
   *
   * Decisions are stored in a single flat list (decisions.json). When
   * entityId is supplied, only decisions whose entity_id matches are returned.
   */
  getDecisions(entityId?: string): Promise<Decision[]>;

  /**
   * Persist the full decisions list for a given entity (replaces existing
   * decisions for that entity_id on write-through adapters).
   */
  putDecisions(entityId: string, data: Decision[]): Promise<void>;

  // --- Patterns ---

  /** Read all patterns (stored as a single array in patterns.json). */
  getPatterns(): Promise<Pattern[]>;

  /** Persist the full patterns array. */
  putPatterns(data: Pattern[]): Promise<void>;

  // --- Sessions ---

  /** Persist an arbitrary session record by session id. */
  putSession(id: string, data: unknown): Promise<void>;

  // --- Audit log ---

  /** Append a single audit entry to the audit log. */
  appendAudit(entry: AuditEntry): Promise<void>;

  /**
   * Read the raw audit log content (newline-delimited JSON).
   * Returns null when the log does not exist yet.
   */
  readAuditLog(): Promise<string | null>;
}

/**
 * ToolContext — passed into every tool handler so it can reach storage without
 * importing file-store.ts directly.
 */
export interface ToolContext {
  storage: StorageAdapter;
}
