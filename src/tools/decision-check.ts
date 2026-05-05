import { Decision } from "../schemas/decision.js";
import { readJsonFile, listJsonFiles, getDecisionsDir } from "../utils/file-store.js";
import { audit } from "../utils/audit.js";

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

  const conflicts: Conflict[] = [];
  const cautions: Conflict[] = [];

  for (const decision of active) {
    const decisionLower = decision.decision.toLowerCase();
    const whyLower = decision.why.toLowerCase();
    const alternativesText = (decision.alternatives || [])
      .map((a) => `${a.option} ${a.rejected_because}`)
      .join(" ")
      .toLowerCase();

    // Direct contradiction: proposed action matches a rejected alternative
    for (const alt of decision.alternatives || []) {
      const altLower = alt.option.toLowerCase();
      const altWords = altLower.split(/\s+/).filter((w) => w.length > 3);
      const overlap = altWords.filter((w) => proposedLower.includes(w));
      const overlapRatio = altWords.length > 0 ? overlap.length / altWords.length : 0;

      if (overlapRatio >= 0.5) {
        conflicts.push({
          decision_id: decision.id,
          decision: decision.decision,
          why_it_was_decided: decision.why,
          decided_on: decision.date,
          review_date: decision.review_date,
          conflict_reason: `Proposed action resembles rejected alternative: "${alt.option}" (rejected because: ${alt.rejected_because})`,
        });
        break;
      }
    }

    // Semantic opposition: check for negation patterns
    const negationPairs = extractNegationConflicts(proposedLower, decisionLower);
    if (negationPairs) {
      conflicts.push({
        decision_id: decision.id,
        decision: decision.decision,
        why_it_was_decided: decision.why,
        decided_on: decision.date,
        review_date: decision.review_date,
        conflict_reason: negationPairs,
      });
      continue;
    }

    // Topic overlap without clear conflict — flag as caution
    const decisionWords = decisionLower.split(/\s+/).filter((w) => w.length > 3);
    const topicOverlap = proposedWords.filter((w) => decisionWords.includes(w) || whyLower.includes(w));
    if (topicOverlap.length >= 3) {
      cautions.push({
        decision_id: decision.id,
        decision: decision.decision,
        why_it_was_decided: decision.why,
        decided_on: decision.date,
        review_date: decision.review_date,
        conflict_reason: `Topic overlap detected. Verify this doesn't contradict the decision. Overlapping terms: ${topicOverlap.join(", ")}`,
      });
    }
  }

  let status: CheckResult["status"];
  let guidance: string;
  const allConflicts = [...conflicts, ...cautions];

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

  return { status, conflicts: allConflicts, guidance };
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
