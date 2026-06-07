import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { getBrainDir, assertSafeId } from "./file-store.js";
import { Entity } from "../schemas/entity.js";
import { calculateStaleness } from "./staleness.js";

/**
 * Pulse files are a human-readable mirror of `.brain/entities/<id>.json`.
 * They are auto-generated on every entity mutation and live at
 * `.brain/pulses/<id>-pulse.md`. They are NOT a source of truth — the JSON
 * is. Pulses exist so a teammate, an SSH session, or a non-MCP tool can grep
 * and read current state without parsing JSON.
 *
 * Never edit pulse files by hand. They will be overwritten on the next
 * entity_update. Use `entity_update` (or any mutating MCP tool) to change state.
 */
export async function syncPulseFile(entity: Entity): Promise<string | null> {
  try {
    assertSafeId(entity.id, "entity.id");
    const brainDir = getBrainDir();
    const pulseDir = join(brainDir, "pulses");
    await mkdir(pulseDir, { recursive: true });

    const path = join(pulseDir, `${entity.id}-pulse.md`);
    const content = renderPulse(entity);
    await writeFile(path, content, "utf-8");
    return path;
  } catch {
    // Pulse sync is a convenience layer — never let it break the mutation.
    return null;
  }
}

function renderPulse(entity: Entity): string {
  const e = entity as unknown as Record<string, unknown>;
  const staleness = entity.last_updated ? calculateStaleness(entity.last_updated) : null;

  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: ${entity.name || entity.id} — Pulse`);
  lines.push(`description: Auto-generated mirror of .brain/entities/${entity.id}.json. Do not edit.`);
  lines.push(`type: project`);
  lines.push(`entity_id: ${entity.id}`);
  lines.push(`generated_at: ${new Date().toISOString()}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${entity.name || entity.id} — Pulse`);
  lines.push("");
  lines.push(`> Auto-generated from \`.brain/entities/${entity.id}.json\`. Do not edit by hand.`);
  lines.push(`> Mutate via \`mcp__brain-os__entity_update\` or other Brain OS mutating tools.`);
  lines.push("");

  field(lines, "status", e.status);
  field(lines, "mode", e.mode);
  field(lines, "mode_reason", e.mode_reason);
  field(lines, "momentum", e.momentum);
  field(lines, "priority", e.priority);
  field(lines, "blocked", e.blocked);
  field(lines, "next_move", e.next_move);
  field(lines, "last_decision", e.last_decision);
  field(lines, "evidence_of_progress", e.evidence_of_progress);
  field(lines, "key_deadline", e.key_deadline);

  if (entity.last_updated) {
    const stalenessLabel = staleness ? ` (${staleness.label})` : "";
    lines.push(`**last_updated:** ${entity.last_updated}${stalenessLabel}`);
    lines.push("");
  }

  if (Array.isArray(e.open_questions) && (e.open_questions as unknown[]).length > 0) {
    lines.push("**open_questions:**");
    for (const q of e.open_questions as string[]) lines.push(`- ${q}`);
    lines.push("");
  }

  if (Array.isArray(e.related_entities) && (e.related_entities as unknown[]).length > 0) {
    lines.push(`**related_entities:** ${(e.related_entities as string[]).join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

function field(lines: string[], key: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  if (typeof value === "object") {
    lines.push(`**${key}:** \`${JSON.stringify(value)}\``);
  } else {
    lines.push(`**${key}:** ${String(value)}`);
  }
  lines.push("");
}
