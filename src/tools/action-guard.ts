import { RiskAssessResult } from "./risk-assess.js";
import { audit } from "../utils/audit.js";

export interface ActionGuardInput {
  assessment: RiskAssessResult;
  action_type: string;
  entity_id?: string;
}

export interface ActionGuardResult {
  decision: "allow" | "ask" | "block";
  message: string;
  required_confirmation?: "explicit";
  matched_rule: string;
}

interface PolicyRule {
  name: string;
  condition: (a: RiskAssessResult, action_type: string) => boolean;
  decision: "allow" | "ask" | "block";
  message: string;
  required_confirmation?: "explicit";
}

// Ordered policy table — first matching rule wins.
// Hard blocks come first, then explicit-confirmation asks, then softer asks, then allow.
const POLICY: PolicyRule[] = [
  {
    name: "private_to_public_block",
    condition: (a) => a.boundary_crossed === "private_to_public",
    decision: "block",
    message:
      "This action moves private Brain OS state (decisions, roadmap, architecture) into a public location. " +
      "Public git history is hard to undo. Confirm explicitly before continuing.",
    required_confirmation: "explicit",
  },
  {
    name: "critical_risk_block",
    condition: (a) => a.risk_level === "critical" && a.boundary_crossed !== "private_to_public",
    decision: "block",
    message: "Critical risk detected. Do not proceed without explicit user confirmation and a stated reason.",
    required_confirmation: "explicit",
  },
  {
    name: "force_push_ask",
    condition: (_, at) => /force.?push|push.*--force/i.test(at),
    decision: "ask",
    message:
      "Force push overwrites remote history and cannot be undone for collaborators. " +
      "Confirm this is intentional.",
    required_confirmation: "explicit",
  },
  {
    name: "npm_publish_ask",
    condition: (a, at) => /npm publish/i.test(at) || a.boundary_crossed === "release",
    decision: "ask",
    message:
      "Publishing to npm cannot be fully retracted. " +
      "Verify version, CHANGELOG, and build output before proceeding.",
    required_confirmation: "explicit",
  },
  {
    name: "security_boundary_ask",
    condition: (a) => a.boundary_crossed === "security",
    decision: "ask",
    message:
      "Action may expose credentials, secrets, or sensitive configuration. " +
      "Verify no private keys or tokens are included.",
    required_confirmation: "explicit",
  },
  {
    name: "irreversible_ask",
    condition: (a) => a.reversibility === "irreversible",
    decision: "ask",
    message: "This action is irreversible. Confirm explicitly before proceeding.",
    required_confirmation: "explicit",
  },
  {
    name: "high_risk_ask",
    condition: (a) => a.risk_level === "high",
    decision: "ask",
    message: "High-risk action detected. Review the risk reasons and confirm intent before proceeding.",
  },
  {
    name: "hard_to_reverse_external_ask",
    condition: (a) =>
      a.reversibility === "hard_to_reverse" && a.boundary_crossed === "local_to_external",
    decision: "ask",
    message:
      "This action pushes state to an external location and is hard to reverse. " +
      "Confirm before proceeding.",
  },
  {
    name: "medium_requires_confirmation_ask",
    condition: (a) => a.risk_level === "medium" && a.requires_confirmation,
    decision: "ask",
    message: "This action requires confirmation. Review the risk assessment before continuing.",
  },
  {
    name: "allow",
    condition: () => true,
    decision: "allow",
    message: "No policy violations detected. Proceed.",
  },
];

export async function guardAction(input: ActionGuardInput): Promise<ActionGuardResult> {
  for (const rule of POLICY) {
    if (rule.condition(input.assessment, input.action_type)) {
      const result: ActionGuardResult = {
        decision: rule.decision,
        message: rule.message,
        ...(rule.required_confirmation ? { required_confirmation: rule.required_confirmation } : {}),
        matched_rule: rule.name,
      };

      await audit(
        "action_guard",
        rule.decision,
        `[${rule.name}] ${input.action_type.slice(0, 80)}`,
        {
          entity_id: input.entity_id,
          after: {
            decision: rule.decision,
            risk_level: input.assessment.risk_level,
            boundary_crossed: input.assessment.boundary_crossed,
          },
        },
      );

      return result;
    }
  }

  // Unreachable — the "allow" rule always matches — but TypeScript requires it
  return { decision: "allow", message: "No policy violations.", matched_rule: "fallback" };
}
