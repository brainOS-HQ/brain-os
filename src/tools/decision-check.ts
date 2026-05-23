import { Decision } from "../schemas/decision.js";
import { readJsonFile, listJsonFiles, getDecisionsDir } from "../utils/file-store.js";
import { audit } from "../utils/audit.js";
import { semanticRecall, EmbeddingsNotConfiguredError } from "../utils/embeddings.js";

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
  embeddings_error?: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary match — "add" no longer matches inside "address" or "padding".
// Falls back to substring for tokens that don't start/end with a word char (rare
// in our keyword lists, but keeps the function total).
function containsWord(text: string, token: string): boolean {
  if (!token) return false;
  const trimmed = token.trim();
  if (!trimmed) return false;
  const startsWord = /^\w/.test(trimmed);
  const endsWord = /\w$/.test(trimmed);
  const left = startsWord ? "\\b" : "";
  const right = endsWord ? "\\b" : "";
  return new RegExp(`${left}${escapeRegex(trimmed)}${right}`, "i").test(text);
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
      const overlap = altWords.filter((w) => containsWord(proposedLower, w));
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
    const topicOverlap = proposedWords.filter((w) => decisionWords.includes(w) || containsWord(whyLower, w));
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

  // Directional semantic layer — separates "matches rejected" from "matches chosen".
  // We distinguish three states:
  //   - available + healthy        : both rejected/chosen lookups completed
  //   - unavailable (not configured): BRAIN_EMBEDDINGS unset → soft, no warning
  //   - degraded (provider crashed) : real error → surface in response so the caller
  //                                    knows conflicts may be under-reported
  let embeddingsAvailable = true;
  let embeddingsError: string | null = null;
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
  } catch (e) {
    embeddingsAvailable = false;
    if (!(e instanceof EmbeddingsNotConfiguredError)) {
      embeddingsError = e instanceof Error ? e.message : String(e);
    }
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

    // Promote to conflict only when rejected-facet similarity beats chosen-facet
    // similarity. A proposal that's 0.95-similar to chosen and 0.66-similar to
    // rejected aligns with the decision — don't hard-STOP on it.
    const alignsRejected =
      embeddingsAvailable &&
      rejectedSim !== undefined &&
      (chosenSim === undefined || rejectedSim > chosenSim);
    const alignsChosen =
      embeddingsAvailable &&
      chosenSim !== undefined &&
      (rejectedSim === undefined || chosenSim >= rejectedSim);

    if (alignsRejected) {
      const sims =
        chosenSim !== undefined
          ? `rejected ${(rejectedSim! * 100).toFixed(0)}% > chosen ${(chosenSim * 100).toFixed(0)}%`
          : `rejected ${(rejectedSim! * 100).toFixed(0)}%`;
      conflicts.push({
        ...base,
        conflict_reason: `${flag.reason} Semantic similarity: ${sims}.`,
      });
    } else if (alignsChosen) {
      // Action aligns with chosen direction more than rejected — drop false positive
      continue;
    } else {
      // No semantic confirmation either way — stay a caution, not a hard stop
      let reasonSuffix: string;
      if (embeddingsError) {
        reasonSuffix = `(Embeddings provider error during check — treating as caution. Error: ${embeddingsError})`;
      } else if (embeddingsAvailable) {
        reasonSuffix = "(Keyword heuristic only; no semantic confirmation.)";
      } else {
        reasonSuffix = "(Embeddings not configured; cannot verify semantic conflict — treating as caution.)";
      }
      cautions.push({
        ...base,
        conflict_reason: `${flag.reason} ${reasonSuffix}`,
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

  if (embeddingsError) {
    guidance += ` Warning: embeddings provider failed during check (${embeddingsError}); semantic conflicts may be under-reported.`;
  }

  await audit("decision_check", "check", `${status}: "${input.proposed_action.slice(0, 100)}"`, {
    entity_id: input.entity_id,
    before: null,
    after: {
      status,
      conflicts_found: conflicts.length,
      cautions_found: cautions.length,
      embeddings_error: embeddingsError,
    },
  });

  return {
    status,
    conflicts: [...conflicts, ...cautions],
    guidance,
    ...(embeddingsError ? { embeddings_error: embeddingsError } : {}),
  };
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
    const proposedA = containsWord(proposed, a);
    const proposedB = containsWord(proposed, b);
    const decidedA = containsWord(decided, a);
    const decidedB = containsWord(decided, b);
    if ((proposedA && decidedB) || (proposedB && decidedA)) {
      return `Directional conflict: proposed action uses "${proposedA ? a : b}" but decision chose "${decidedA ? a : b}"`;
    }
  }

  return null;
}
