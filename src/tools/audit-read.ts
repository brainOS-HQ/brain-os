import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { getBrainDir } from "../utils/file-store.js";
import { AuditEntry } from "../utils/audit.js";

interface AuditReadResult {
  entries: AuditEntry[];
  total: number;
  showing: number;
  malformed_lines: number;
}

export async function readAuditLog(options?: {
  entity_id?: string;
  tool?: string;
  last_n?: number;
}): Promise<AuditReadResult> {
  const path = join(getBrainDir(), "audit.jsonl");
  if (!existsSync(path)) {
    return { entries: [], total: 0, showing: 0, malformed_lines: 0 };
  }

  const raw = await readFile(path, "utf-8");
  const lines = raw.trim().split("\n").filter(Boolean);

  // Parse line-by-line and skip-with-count any that fail. Concurrent
  // appendFile from multiple MCP clients can interleave writes that exceed
  // PIPE_BUF (~4 KB), and any external editor that touches the file can
  // produce malformed lines. Previously a single bad line crashed audit_log
  // permanently. Now we report the skip count and keep going.
  let entries: AuditEntry[] = [];
  let malformed = 0;
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as AuditEntry);
    } catch {
      malformed++;
    }
  }

  const total = entries.length;

  if (options?.entity_id) {
    entries = entries.filter((e) => e.entity_id === options.entity_id);
  }
  if (options?.tool) {
    entries = entries.filter((e) => e.tool === options.tool);
  }

  const limit = options?.last_n ?? 20;
  entries = entries.slice(-limit);

  return { entries, total, showing: entries.length, malformed_lines: malformed };
}
