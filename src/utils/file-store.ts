import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

export async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files.filter((f) => f.endsWith(".json")).map((f) => join(dir, f));
  } catch {
    return [];
  }
}
