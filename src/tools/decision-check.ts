import { Decision } from "../schemas/decision.js";
import { readJsonFile, listJsonFiles, getDecisionsDir } from "../utils/file-store.js";
import { audit } from "../utils/audit.js";
import { semanticRecall } from "../utils/embeddings.js";

interface CheckInput {
  proposed_action: string;
  entity_id?: string;
}

interface Conflict {
  decision_id: string;
  decision: string;
  why_it_was_decided: string;
  decided_on: string;
  review_date: string;
  conflict_reason: string;
}

interface CheckResult {
  status: "clear" | "conflict" | "caution";
  conflicts: Conflict[];
  guidance: string;
}

export async function checkDecision(input: CheckInput): Promise<CheckResult> {
  const decisionFiles = await listJsonFiles(getDecisionsDir());
  const allDecisions: Decision[] = [];
  for (const file of decisionFiles) {
    const data = await readJsonFile<Decision[]>(file);
    if (data) allDecisions.push(...data);
  }

  const active = allDecisions.filter((d) => {
    if (d.status !== "active") return false;
    if (input.entity_id && d.entity_id !== input.entity_id) return false;
    return true;
  });

  if (active.length === 0) {
    return {
      status: "clear",
      conflicts: [],
      guidance: "No active decisions to check against. Proceed.",
    };
  }

  const proposedLower = input.proposed_action.toLowerCase();
  const proposedWords = proposedLower.split(/\s+/).filter((w) => w.length > 3);

  // Keyword heuristics collect suspicions; the directional semantic layer below
  // decides whether to promote them to a hard `conflict` (STOP) or drop them
  // when the proposed action actually aligns with the chosen direction.
  type KeywordFlag = { decision: Decision; reason: string };
  const keywordFlags = new Map<string, KeywordFlag>();
  const topicCautions: Conflict[] = [];

  for (const decision of active) {
    const decisionLower = decision.decision.toLowerCase();
    const whyLower = decision.why.toLowerCase();

    // Layer 1: rejected-alternative word overlap (eligible for conflict promotion)
    let layer1Hit = false;
    for (const alt of decision.alternatives || []) {
      const altLower = alt.option.toLowerCase();
      const altWords = altLower.split(/\s+/).filter((w) => w.length > 3);
      const overlap = altWords.filter((w) => proposedLower.includes(w));
      const overlapRatio = altWords.length > 0 ? overlap.length / altWords.length : 0;

      if (overlapRatio >= 0.5) {
        keywordFlags.set(decision.id, {
          decision,
          reason: `Proposed action resembles rejected alternative: "${alt.option}" (rejected because: ${alt.rejected_because}).`,
        });
        layer1Hit = true;
        break;
      }
    }
    if (layer1Hit) continue;

    // Layer 2: negation pairs (eligible for conflict promotion)
    const negationConflict = extractNegationConflicts(proposedLower, decisionLower);
    if (negationConflict) {
      keywordFlags.set(decision.id, { decision, reason: negationConflict });
      continue;
    }

    // Layer 3: topic overlap → caution only (never promoted to conflict)
    const decisionWords = decisionLower.split(/\s+/).filter((w) => w.length > 3);
    const topicOverlap = proposedWords.filter((w) => decisionWords.includes(w) || whyLower.includes(w));
    if (topicOverlap.length >= 3) {
      topicCautions.push({
        decision_id: decision.id,
        decision: decision.decision,
        why_it_was_decided: decision.why,
        decided_on: decision.date,
        review_date: decision.review_date,
        conflict_reason: `Topic overlap detected. Verify this doesn't contradict the decision. Overlapping terms: ${topicOverlap.join(", ")}`,
      });
    }
  }

  // Directional semantic layer — separates "matches rejected" from "matches chosen"
  let embeddingsAvailable = true;
  const rejectedHits = new Map<string, number>();
  const chosenHits = new Map<string, number>();

  try {
    const rejectedMatches = await semanticRecall(input.proposed_action, {
      sourceKind: "decision",
      facet: "rejected",
      k: 10,
      threshold: 0.65,
    });
    for (const m of rejectedMatches) rejectedHits.set(m.source_id, m.similarity);

    const chosenMatches = await semanticRecall(input.proposed_action, {
      sourceKind: "decision",
      facet: "chosen",
      k: 10,
      threshold: 0.5,
    });
    for (const m of chosenMatches) chosenHits.set(m.source_id, m.similarity);
  } catch {
    embeddingsAvailable = false;
  }

  const conflicts: Conflict[] = [];
  const cautions: Conflict[] = [...topicCautions];

  // Apply promotion / drop / hold to keyword-flagged decisions
  for (const [decisionId, flag] of keywordFlags) {
    const rejectedSim = rejectedHits.get(decisionId);
    const chosenSim = chosenHits.get(decisionId);
    const base = {
      decision_id: decisionId,
      decision: flag.decision.decision,
      why_it_was_decided: flag.decision.why,
      decided_on: flag.decision.date,
      review_date: flag.decision.review_date,
    };

    if (embeddingsAvailable && rejectedSim !== undefined) {
      // Keyword + semantic-rejected hit = real conflict
      conflicts.push({
        ...base,
        conflict_reason: `${flag.reason} Semantic similarity to rejected alternatives: ${(rejectedSim * 100).toFixed(0)}%.`,
      });
    } else if (embeddingsAvailable && chosenSim !== undefined && rejectedSim === undefined) {
      // Keyword hit but semantic says action aligns with chosen direction — drop false positive
      continue;
    } else {
      // No semantic confirmation either way — stay a caution, not a hard stop
      cautions.push({
        ...base,
        conflict_reason: embeddingsAvailable
          ? `${flag.reason} (Keyword heuristic only; no semantic confirmation.)`
          : `${flag.reason} (Embeddings not configured; cannot verify semantic conflict — treating as caution.)`,
      });
    }
  }

  // Semantic-only suspicion: rejected-facet hit without keyword flag
  for (const [decisionId, sim] of rejectedHits) {
    if (keywordFlags.has(decisionId)) continue;
    const decision = active.find((d) => d.id === decisionId);
    if (!decision) continue;
    cautions.push({
      decision_id: decision.id,
      decision: decision.decision,
      why_it_was_decided: decision.why,
      decided_on: decision.date,
      review_date: decision.review_date,
      conflict_reason: `Proposed action semantically resembles a rejected alternative for this decision (${(sim * 100).toFixed(0)}% similarity). Verify intent before proceeding.`,
    });
  }

  let status: CheckResult["status"];
  let guidance: string;

  if (conflicts.length > 0) {
    status = "conflict";
    guidance = `STOP. This action conflicts with ${conflicts.length} active decision(s). Do not proceed unless the user explicitly asks to revisit the decision. Show them the conflict and ask for confirmation.`;
  } else if (cautions.length > 0) {
    status = "caution";
    guidance = `Proceed with awareness. ${cautions.length} active decision(s) touch the same topic. Verify your action is compatible before continuing.`;
  } else {
    status = "clear";
    guidance = "No conflicts found with active decisions. Proceed.";
  }

  await audit("decision_check", "check", `${status}: "${input.proposed_action.slice(0, 100)}"`, {
    entity_id: input.entity_id,
    before: null,
    after: { status, conflicts_found: conflicts.length, cautions_found: cautions.length },
  });

  return { status, conflicts: [...conflicts, ...cautions], guidance };
}

function extractNegationConflicts(proposed: string, decided: string): string | null {
  const opposites: Array<[string, string]> = [
    ["add", "remove"],
    ["add", "not use"],
    ["add", "avoid"],
    ["use", "not use"],
    ["use", "avoid"],
    ["build", "not build"],
    ["build", "avoid building"],
    ["include", "exclude"],
    ["include", "not include"],
    ["enable", "disable"],
    ["start", "stop"],
    ["keep", "remove"],
    ["keep", "drop"],
    ["local", "cloud"],
    ["free", "paid"],
    ["simple", "complex"],
    ["monolith", "microservice"],
    ["single", "multiple"],
  ];

  for (const [a, b] of opposites) {
    if (
      (proposed.includes(a) && decided.includes(b)) ||
      (proposed.includes(b) && decided.includes(a))
    ) {
      return `Directional conflict: proposed action uses "${proposed.includes(a) ? a : b}" but decision chose "${decided.includes(a) ? a : b}"`;
    }
  }

  return null;
}
