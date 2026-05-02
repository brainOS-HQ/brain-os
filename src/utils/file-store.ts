import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const BRAIN_DIR = process.env.BRAIN_DIR || join(process.cwd(), ".brain");

export function getBrainDir(): string {
  return BRAIN_DIR;
}

export function getEntitiesDir(): string {
  return join(BRAIN_DIR, "entities");
}

export function getDecisionsDir(): string {
  return join(BRAIN_DIR, "decisions");
}

export function getPatternsDir(): string {
  return join(BRAIN_DIR, "patterns");
}

export function getSessionsDir(): string {
  return join(BRAIN_DIR, "sessions");
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
