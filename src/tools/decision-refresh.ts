import { Decision } from "../schemas/decision.js";
import { readJsonFile, writeJsonFile, getDecisionsDir } from "../utils/file-store.js";
import { today } from "../utils/staleness.js";
import { embedDecision } from "../utils/embeddings.js";
import { audit } from "../utils/audit.js";
import { join } from "path";

interface RefreshInput {
  decision_id: string;
  review_date?: string;
  add_evidence?: string;
  status?: "active" | "superseded" | "archived";
}

interface RefreshResult {
  decision: Decision;
  changes: string[];
  re_embedded: boolean;
}

/**
 * decision_refresh — metadata / lifecycle operation on an existing decision.
 *
 * Decisions are append-only by design (good for audit-log fidelity). This tool
 * exists for the common case of bumping `review_date` forward when a decision
 * is still valid, appending evidence, or marking a decision superseded /
 * archived — without losing audit history by editing JSON directly.
 *
 * Does NOT mutate decision content (decision text, why, alternatives,
 * chosen_direction, proof_action). For content-level changes, log a new
 * decision via `decision_log`.
 */
export async function refreshDecision(input: RefreshInput): Promise<RefreshResult> {
  const decisionsFile = join(getDecisionsDir(), "decisions.json");
  const decisions = (await readJsonFile<Decision[]>(decisionsFile)) || [];

  const idx = decisions.findIndex((d) => d.id === input.decision_id);
  if (idx === -1) {
    throw new Error(`Decision "${input.decision_id}" not found.`);
  }

  const before: Decision = JSON.parse(JSON.stringify(decisions[idx]));
  const decision = decisions[idx];
  const changes: string[] = [];

  if (input.review_date !== undefined && input.review_date !== decision.review_date) {
    changes.push(`review_date: ${decision.review_date} → ${input.review_date}`);
    decision.review_date = input.review_date;
  }

  if (input.status !== undefined && input.status !== decision.status) {
    changes.push(`status: ${decision.status} → ${input.status}`);
    decision.status = input.status;
    if (input.status !== "superseded" && decision.superseded_by) {
      changes.push(`superseded_by: ${decision.superseded_by} → null`);
      decision.superseded_by = null;
    }
  }

  let reEmbedded = false;
  if (input.add_evidence !== undefined && input.add_evidence.trim().length > 0) {
    if (!decision.evidence_appended) decision.evidence_appended = [];
    const entry = { date: today(), note: input.add_evidence.trim() };
    decision.evidence_appended.push(entry);
    changes.push(`evidence_appended: +${entry.date} "${entry.note.slice(0, 60)}${entry.note.length > 60 ? "..." : ""}"`);
    reEmbedded = true;
  }

  if (changes.length === 0) {
    return { decision, changes: [], re_embedded: false };
  }

  await writeJsonFile(decisionsFile, decisions);

  await audit("decision_refresh", "refresh", changes.join("; "), {
    entity_id: decision.entity_id,
    before,
    after: decision,
  });

  if (reEmbedded) {
    embedDecision(decision.id, decision as unknown as Record<string, unknown>).catch(() => {});
  }

  return { decision, changes, re_embedded: reEmbedded };
}
