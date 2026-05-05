import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { getBrainDir } from "../utils/file-store.js";
import { AuditEntry } from "../utils/audit.js";

interface AuditReadResult {
  entries: AuditEntry[];
  total: number;
  showing: number;
}

export async function readAuditLog(options?: {
  entity_id?: string;
  tool?: string;
  last_n?: number;
}): Promise<AuditReadResult> {
  const path = join(getBrainDir(), "audit.jsonl");
  if (!existsSync(path)) {
    return { entries: [], total: 0, showing: 0 };
  }

  const raw = await readFile(path, "utf-8");
  const lines = raw.trim().split("\n").filter(Boolean);

  let entries: AuditEntry[] = lines.map((line) => JSON.parse(line));

  const total = entries.length;

  if (options?.entity_id) {
    entries = entries.filter((e) => e.entity_id === options.entity_id);
  }
  if (options?.tool) {
    entries = entries.filter((e) => e.tool === options.tool);
  }

  const limit = options?.last_n ?? 20;
  entries = entries.slice(-limit);

  return { entries, total, showing: entries.length };
}
