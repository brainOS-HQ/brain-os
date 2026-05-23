import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { getBrainDir } from "./file-store.js";

export interface AuditEntry {
  timestamp: string;
  tool: string;
  entity_id: string | null;
  action: string;
  summary: string;
  before: unknown | null;
  after: unknown | null;
  session_id: string | null;
}

function getAuditPath(): string {
  return join(getBrainDir(), "audit.jsonl");
}

let currentSessionId: string | null = null;

export function setSessionId(id: string): void {
  currentSessionId = id;
}

export function getSessionId(): string {
  if (!currentSessionId) {
    currentSessionId = `session-${Date.now()}`;
  }
  return currentSessionId;
}

export async function audit(
  tool: string,
  action: string,
  summary: string,
  options?: {
    entity_id?: string;
    before?: unknown;
    after?: unknown;
    // Pass explicitly when running in a stateless context (e.g. a Worker)
    // where the module-level singleton can't carry the session across calls.
    session_id?: string;
  }
): Promise<void> {
  const dir = getBrainDir();
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    tool,
    entity_id: options?.entity_id ?? null,
    action,
    summary,
    before: options?.before ?? null,
    after: options?.after ?? null,
    session_id: options?.session_id ?? getSessionId(),
  };

  await appendFile(getAuditPath(), JSON.stringify(entry) + "\n", "utf-8");
}
