import { readdir, readFile, writeFile, mkdir, rename, unlink } from "fs/promises";
import { join, dirname } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Whitelist for any user-supplied id that becomes a filesystem path segment.
// Brain OS ids (entity_id, decision_id, step_id) are user-controlled strings
// that get concatenated into paths like .brain/entities/<id>.json. Without
// validation a caller could pass "../../../etc/passwd" and escape .brain/.
// Reject anything that isn't kebab-case + alphanumeric + underscore.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

export function assertSafeId(id: unknown, kind: string): asserts id is string {
  if (typeof id !== "string" || !SAFE_ID.test(id)) {
    throw new Error(
      `Invalid ${kind} "${String(id)}". Must be 1-100 chars, start with an ` +
      `alphanumeric, and contain only letters, digits, hyphen, or underscore. ` +
      `Rejected to prevent path traversal.`
    );
  }
}

let cachedBrainDir: string | null = null;
let mcpServerRef: McpServer | null = null;

function walkUpForBrain(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, ".brain");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function resolveBrainDir(): Promise<string> {
  if (process.env.BRAIN_DIR) return process.env.BRAIN_DIR;

  if (mcpServerRef) {
    try {
      const result = await mcpServerRef.server.listRoots();
      for (const root of result.roots ?? []) {
        if (root.uri.startsWith("file://")) {
          const rootPath = fileURLToPath(root.uri);
          const found = walkUpForBrain(rootPath);
          if (found) return found;
        }
      }
    } catch {
      // Client doesn't support roots — fall through to walk-up
    }
  }

  const walkUpResult = walkUpForBrain(process.cwd());
  if (walkUpResult) return walkUpResult;

  return join(process.cwd(), ".brain");
}

export function registerMcpServer(server: McpServer): void {
  mcpServerRef = server;
}

export async function initBrainDir(): Promise<string> {
  if (cachedBrainDir) return cachedBrainDir;
  cachedBrainDir = await resolveBrainDir();
  return cachedBrainDir;
}

export function getBrainDir(): string {
  if (!cachedBrainDir) {
    cachedBrainDir =
      process.env.BRAIN_DIR ??
      walkUpForBrain(process.cwd()) ??
      join(process.cwd(), ".brain");
  }
  return cachedBrainDir;
}

export function getEntitiesDir(): string {
  return join(getBrainDir(), "entities");
}

export function getDecisionsDir(): string {
  return join(getBrainDir(), "decisions");
}

export function getPatternsDir(): string {
  return join(getBrainDir(), "patterns");
}

export function getSessionsDir(): string {
  return join(getBrainDir(), "sessions");
}

export async function ensureDirs(): Promise<void> {
  for (const dir of [getEntitiesDir(), getDecisionsDir(), getPatternsDir(), getSessionsDir()]) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export async function writeJsonFile(path: string, data: unknown): Promise<void> {
  // Atomic write: serialize to a unique tmp file in the same directory, then
  // rename into place. Prevents corruption from a mid-write crash and from
  // truncated reads by another process. Tmp filename includes pid + ms + a
  // random suffix so concurrent in-process writes (Promise.all) can't pick
  // the same tmp name and trip ENOENT during rename.
  //
  // KNOWN LIMIT: this does NOT prevent the load-modify-save race where two
  // writers both read the file, both modify in memory, both write — the
  // second write silently clobbers the first. That is tracked as v0.5.1
  // optimistic locking and is documented in the entity's open_questions.
  const rand = Math.random().toString(36).slice(2, 10);
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}-${rand}`;
  try {
    await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await rename(tmpPath, path);
  } catch (e) {
    try { await unlink(tmpPath); } catch { /* ignore */ }
    throw e;
  }
}

export async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files.filter((f) => f.endsWith(".json")).map((f) => join(dir, f));
  } catch {
    return [];
  }
}
