import { appendFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { StorageAdapter } from "./adapter.js";
import type { Entity } from "../schemas/entity.js";
import type { Decision } from "../schemas/decision.js";
import type { Pattern } from "../schemas/pattern.js";
import type { AuditEntry } from "../utils/audit.js";
import {
  getBrainDir,
  getEntitiesDir,
  getDecisionsDir,
  getPatternsDir,
  getSessionsDir,
  readJsonFile,
  writeJsonFile,
  listJsonFiles,
} from "../utils/file-store.js";

/**
 * LocalJsonAdapter — implements StorageAdapter by delegating to the existing
 * file-store.ts functions. This is a pure wrapper: no logic is duplicated here,
 * every method calls the corresponding file-store helper and maps the result to
 * the StorageAdapter contract.
 *
 * Decisions are stored as a single flat list in decisions/decisions.json (not
 * per-entity files). When entityId is passed to getDecisions, the result is
 * filtered in-process after reading the full list.
 *
 * putDecisions replaces the entries for the given entityId in the shared file
 * (merges the new slice with unrelated entries and writes back atomically via
 * writeJsonFile).
 */
function assertSafeId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(`Invalid id "${id}" — must match [a-z0-9][a-z0-9-]*`);
  }
}

export class LocalJsonAdapter implements StorageAdapter {
  // --- Entities ---

  async getEntity(id: string): Promise<Entity | null> {
    assertSafeId(id);
    const path = join(getEntitiesDir(), `${id}.json`);
    return readJsonFile<Entity>(path);
  }

  async putEntity(id: string, data: Entity): Promise<void> {
    assertSafeId(id);
    const path = join(getEntitiesDir(), `${id}.json`);
    await writeJsonFile(path, data);
  }

  async listEntities(): Promise<Entity[]> {
    const files = await listJsonFiles(getEntitiesDir());
    const entities: Entity[] = [];
    for (const file of files) {
      const entity = await readJsonFile<Entity>(file);
      if (entity) entities.push(entity);
    }
    return entities;
  }

  // --- Decisions ---

  async getDecisions(entityId?: string): Promise<Decision[]> {
    // Decisions can live across multiple files in getDecisionsDir() (e.g.
    // future sharding), so we scan all JSON files in the dir.
    const files = await listJsonFiles(getDecisionsDir());
    const all: Decision[] = [];
    for (const file of files) {
      const data = await readJsonFile<Decision[]>(file);
      if (data) all.push(...data);
    }
    if (entityId) {
      return all.filter((d) => d.entity_id === entityId);
    }
    return all;
  }

  async putDecisions(entityId: string, data: Decision[]): Promise<void> {
    const decisionsFile = join(getDecisionsDir(), "decisions.json");
    const existing = (await readJsonFile<Decision[]>(decisionsFile)) ?? [];
    // Retain decisions belonging to other entities, replace those for entityId.
    const others = existing.filter((d) => d.entity_id !== entityId);
    await writeJsonFile(decisionsFile, [...others, ...data]);
  }

  // --- Patterns ---

  async getPatterns(): Promise<Pattern[]> {
    const patternFile = join(getPatternsDir(), "patterns.json");
    return (await readJsonFile<Pattern[]>(patternFile)) ?? [];
  }

  async putPatterns(data: Pattern[]): Promise<void> {
    const patternFile = join(getPatternsDir(), "patterns.json");
    await writeJsonFile(patternFile, data);
  }

  // --- Sessions ---

  async putSession(id: string, data: unknown): Promise<void> {
    assertSafeId(id);
    const sessionPath = join(getSessionsDir(), `${id}.json`);
    await writeJsonFile(sessionPath, data);
  }

  // --- Audit log ---

  async appendAudit(entry: AuditEntry): Promise<void> {
    const dir = getBrainDir();
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const path = join(dir, "audit.jsonl");
    await appendFile(path, JSON.stringify(entry) + "\n", "utf-8");
  }

  async readAuditLog(): Promise<string | null> {
    const path = join(getBrainDir(), "audit.jsonl");
    if (!existsSync(path)) return null;
    return readFile(path, "utf-8");
  }
}

/**
 * Factory function — creates a new LocalJsonAdapter instance.
 * Provided for convenience; adapters hold no mutable instance state so a
 * singleton is equally valid, but callers may prefer a fresh instance.
 */
export function createLocalJsonAdapter(): LocalJsonAdapter {
  return new LocalJsonAdapter();
}
