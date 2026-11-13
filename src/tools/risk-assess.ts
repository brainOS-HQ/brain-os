import { audit } from "../utils/audit.js";

// "not_assessed" means no rule matched. It is not a level: it says nothing about safety.
export type RiskLevel = "low" | "medium" | "high" | "critical" | "not_assessed";
export type BoundaryCrossed =
  | "none"
  | "private_to_public"
  | "local_to_external"
  | "destructive"
  | "release"
  | "security";
export type Reversibility = "reversible" | "hard_to_reverse" | "irreversible" | "unknown";

export interface RiskAssessInput {
  proposed_action: string;
  entity_id?: string;
  diff?: string;
  files_touched?: string[];
  target_visibility?: "public" | "private" | "unknown";
  git_status?: string;
  package_info?: { name: string; version: string; registry?: string };
}

export interface RiskAssessResult {
  risk_level: RiskLevel;
  boundary_crossed: BoundaryCrossed;
  reversibility: Reversibility;
  requires_confirmation: boolean;
  risk_reasons: string[];
  // true when no pattern matched and the full analysis was not run
  pre_filter_skipped: boolean;
}

// Accept both literal shell commands and clear natural-language descriptions.
// Callers often describe the intended action instead of pasting the exact command.
const GIT_PUSH_PATTERN =
  /\bgit push\b|\bpush(?:es|ed|ing)?\b[^.\n]{0,120}\b(?:branch|commit|tag|repo(?:sitory)?|remote|github)\b|\b(?:branch|commit|tag|repo(?:sitory)?|remote|github)\b[^.\n]{0,120}\bpush(?:es|ed|ing)?\b/i;

// ──────────────────────────────────────────────────────────────────────────────
// Destructive actions. One table drives both the pre-filter and the reasons, so
// a pattern can never get an action past the pre-filter without also producing
// a finding. Patterns run against the action as written (not lowercased):
// `git branch -D` and `git branch -d` are different commands.
// ──────────────────────────────────────────────────────────────────────────────
interface DestructiveRule {
  pattern: RegExp;
  reason: string;
  irreversible: boolean;
}

const DESTRUCTIVE_TARGETS =
  "(?:\\b(?:databases?|db|tables?|schemas?|buckets?|namespaces?|volumes?|clusters?|folders?|director(?:y|ies)|dirs?|repos?|repositor(?:y|ies)|branch(?:es)?|files?|prod(?:uction)?)\\b|\\.brain\\b)";

const DESTRUCTIVE_RULES: DestructiveRule[] = [
  { pattern: /\bgit\s+reset\b.*--hard\b/i, reason: "git reset --hard discards uncommitted changes permanently.", irreversible: true },
  { pattern: /\bforce.?push\b|push.*--force/i, reason: "Force push overwrites remote history and cannot be undone for collaborators.", irreversible: false },
  { pattern: /\bgit\s+rm\b/i, reason: "git rm removes files from version control history.", irreversible: false },
  { pattern: /\bgit\s+clean\b/i, reason: "git clean deletes untracked files; Git keeps no copy of them.", irreversible: true },
  { pattern: /\bgit\s+checkout\s+(?:--(?:\s|$)|\.(?:\s|$))|\bgit\s+restore\b/i, reason: "This discards uncommitted changes in the working tree.", irreversible: true },
  { pattern: /\bgit\s+branch\b[^\n]*\s(?:-D\b|--delete\s+--force\b|-d\s+--force\b|--force\s+(?:-d|--delete)\b)/, reason: "git branch -D deletes a branch even when its commits are not merged anywhere.", irreversible: false },
  { pattern: /\bgit\s+stash\s+(?:drop|clear)\b/i, reason: "Dropping a stash discards the changes saved in it.", irreversible: false },
  { pattern: /\brm\s+(?:-[a-z-]+\s+)*[^\s-]|\b(?:rmdir|remove-item)\b/i, reason: "rm deletes files permanently, without a confirmation prompt or a trash folder.", irreversible: true },
  { pattern: /\bdrop\s+(?:table|database|schema)\b/i, reason: "DROP TABLE / DATABASE / SCHEMA is irreversible in most databases without a backup.", irreversible: true },
  { pattern: /\btruncate\b/i, reason: "TRUNCATE removes all rows and cannot be rolled back in some databases.", irreversible: true },
  { pattern: /\bdelete\s+from\b/i, reason: "DELETE FROM removes rows; without a backup or an open transaction they are gone.", irreversible: true },
  { pattern: /\bkubectl\s+delete\b/i, reason: "kubectl delete removes live cluster resources.", irreversible: true },
  { pattern: /\bdestroy(?:s|ed|ing)?\b/i, reason: "A destroy action tears down resources and what they hold.", irreversible: true },
  { pattern: /\b(?:wip(?:e|es|ed|ing)|eras(?:e|es|ed|ing)|purg(?:e|es|ed|ing))\b/i, reason: "Wiping, erasing or purging removes data without a way back.", irreversible: true },
  {
    pattern: new RegExp(
      `\\b(?:delet(?:e|es|ed|ing)|remov(?:e|es|ed|ing)|drop(?:s|ped|ping)?)\\b[^.\\n]{0,80}${DESTRUCTIVE_TARGETS}`,
      "i",
    ),
    reason: "This deletes or removes files, branches or stored data.",
    irreversible: false,
  },
  { pattern: /\boverwrit(?:e|es|ing)\b|\boverwritten\b/i, reason: "Overwriting replaces existing content.", irreversible: false },
];

// Sending something off this machine with a command-line transfer tool.
const TRANSFER_TOOL = /\b(?:curl|wget|scp|sftp|rsync|ncat|nc|ftp)\b/i;
const TRANSFER_SENDS_DATA =
  /(?:-X\s*(?:POST|PUT|PATCH)\b|--request\s+(?:POST|PUT|PATCH)\b|\s-d\b|--data\b|\s-F\b|--form\b|\s-T\b|--upload-file\b|--post-(?:data|file)\b)/i;
const SENSITIVE_IN_ACTION =
  /\.env\b|\bsecrets?\b|\bapi[_-]?keys?\b|\bpasswords?\b|\bcredentials?\b|\bprivate[_-]?key\b|\baccess[_-]?key\b|\bid_rsa\b|\.pem\b|\btokens?\b/i;
const FINANCIAL = /\b(?:billing|payments?|charg(?:e|es|ed|ing))\b/i;
const WRITES_ENV_FILE = /write.*\.env|\.env.*write/i;

// ──────────────────────────────────────────────────────────────────────────────
// Pre-filter: the other patterns that send an action to the full analysis
// (the destructive rules above are always included). An action that matches
// nothing is NOT assessed, which is different from safe.
// ──────────────────────────────────────────────────────────────────────────────
const TRIGGER_PATTERNS: RegExp[] = [
  /\bnpm publish\b/i,
  GIT_PUSH_PATTERN,
  /\bgit tag\b/i,
  /\bdeploy\b/i,
  /\bwrangler (publish|deploy)\b/i,
  /\bsend.*email\b/i,
  /\bpost.*api\b/i,
  /\bapi.*call.*post\b/i,
  /\bwebhook\b/i,
  FINANCIAL,
  TRANSFER_TOOL,
  /\bpublic\s+repo\b/i,
  /\bpublic\s+repository\b/i,
  /\broadmap.*public\b/i,
  /\bpublic.*roadmap\b/i,
  WRITES_ENV_FILE,
];

// Private path markers — files that must never reach a public destination
const PRIVATE_PATH_PATTERNS: RegExp[] = [
  /\.brain[/\\]/i,
  /\.brain$/i,
  /\broadmap\b/i,
  /[/\\]decisions[/\\]/i,
  /\barchitecture\b/i,
  /\bprivate\b/i,
  /changelog.*internal/i,
  /internal.*changelog/i,
];

// Signals that the target destination is public
const PUBLIC_TARGET_SIGNALS: RegExp[] = [
  /\bgithub\b/i,
  /\bnpm publish\b/i,
  GIT_PUSH_PATTERN,
  /\bpublic repo(sitory)?\b/i,
  /\bpush.*origin\b/i,
  /\bremote.*public\b/i,
];

// ──────────────────────────────────────────────────────────────────────────────
// Signal detectors — each returns the reasons it found, empty if none
// ──────────────────────────────────────────────────────────────────────────────

function detectPrivateToPublic(input: RiskAssessInput): string[] {
  const reasons: string[] = [];

  const privatePaths = (input.files_touched ?? []).filter((f) =>
    PRIVATE_PATH_PATTERNS.some((p) => p.test(f)),
  );

  const isPublicTarget =
    input.target_visibility === "public" ||
    PUBLIC_TARGET_SIGNALS.some((p) => p.test(input.proposed_action));

  if (privatePaths.length > 0 && isPublicTarget) {
    reasons.push(
      `Files contain private state data (${privatePaths.join(", ")}) and the action targets a public location.`,
    );
  }

  if (input.diff && isPublicTarget) {
    const diffLower = input.diff.toLowerCase();
    const privateMarkers = [".brain/", "roadmap:", "decisions:", "architecture:", "private:"];
    const found = privateMarkers.filter((m) => diffLower.includes(m));
    if (found.length > 0) {
      reasons.push(
        `Diff contains private content markers (${found.join(", ")}) and the action targets a public location.`,
      );
    }
  }

  return reasons;
}

function matchDestructive(action: string): DestructiveRule[] {
  return DESTRUCTIVE_RULES.filter(({ pattern }) => pattern.test(action));
}

function detectRelease(
  lower: string,
  packageInfo?: { name: string; version: string; registry?: string },
): string[] {
  const reasons: string[] = [];

  if (/\bnpm publish\b/.test(lower)) {
    const label = packageInfo
      ? `${packageInfo.name}@${packageInfo.version}`
      : "the package";
    reasons.push(
      `Publishing ${label} to npm. Published versions cannot be fully unpublished and are immediately downloadable.`,
    );
  }
  if (/\bgit tag\b/.test(lower)) {
    reasons.push("Creating a git tag. Once pushed, tags are visible to all repository collaborators.");
  }
  if (/\bdeploy\b|\bwrangler (publish|deploy)\b/.test(lower)) {
    reasons.push("Deployment action will affect a production or publicly reachable environment.");
  }

  return reasons;
}

function detectLocalToExternal(lower: string): string[] {
  const reasons: string[] = [];

  if (GIT_PUSH_PATTERN.test(lower) && !/force/.test(lower)) {
    reasons.push("Pushing commits to remote makes them visible to all collaborators.");
  }
  if (/\bsend.*email\b/.test(lower)) {
    reasons.push("Sending an email cannot be retracted once delivered.");
  }
  if (/\bwebhook\b/.test(lower) || /\bpost.*api\b/.test(lower) || /\bapi.*call.*post\b/.test(lower)) {
    reasons.push("Writing to an external API or webhook has side effects outside this session.");
  }
  if (TRANSFER_TOOL.test(lower) && TRANSFER_SENDS_DATA.test(lower)) {
    reasons.push("This command sends data from this machine to another host.");
  }
  if (FINANCIAL.test(lower)) {
    reasons.push("Billing and payment actions have real financial effect outside this session.");
  }

  return reasons;
}

function detectSecurity(input: RiskAssessInput): string[] {
  const reasons: string[] = [];
  const secMarkers = ["secret", ".env", "api_key", "apikey", "password", "credential", "token", "private_key", "access_key"];

  if (input.diff) {
    const found = secMarkers.filter((m) => input.diff!.toLowerCase().includes(m));
    if (found.length > 0) {
      reasons.push(`Diff may contain sensitive credentials or secrets (${found.join(", ")}).`);
    }
  }

  const sensitiveFiles = (input.files_touched ?? []).filter(
    (f) => secMarkers.some((m) => f.toLowerCase().includes(m)) || f.endsWith(".env"),
  );
  if (sensitiveFiles.length > 0) {
    reasons.push(`Action touches potentially sensitive files: ${sensitiveFiles.join(", ")}.`);
  }

  const action = input.proposed_action;
  if (TRANSFER_TOOL.test(action) && SENSITIVE_IN_ACTION.test(action)) {
    reasons.push("The command transfers data and names a credential or secret (for example an environment file, key or token).");
  }
  if (WRITES_ENV_FILE.test(action)) {
    reasons.push("Action writes to an environment file, which usually holds credentials.");
  }

  return reasons;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

// Returned when no rule matched. It carries no verdict: not "low", not "safe".
const NOT_ASSESSED_REASON =
  "No Brain OS risk rule matched this action, so it was not assessed. This is not a safety verdict: " +
  "the rules cover a fixed list of patterns, and an action outside that list can still be destructive.";

function notAssessed(preFilterSkipped: boolean): RiskAssessResult {
  return {
    risk_level: "not_assessed",
    boundary_crossed: "none",
    reversibility: "unknown",
    requires_confirmation: false,
    risk_reasons: [NOT_ASSESSED_REASON],
    pre_filter_skipped: preFilterSkipped,
  };
}

export async function assessRisk(input: RiskAssessInput): Promise<RiskAssessResult> {
  const action = input.proposed_action.trim();
  const lower = action.toLowerCase();
  const destructive = matchDestructive(action);

  // Pre-filter: skip the full analysis if no rule could apply.
  const triggerFromAction = destructive.length > 0 || TRIGGER_PATTERNS.some((p) => p.test(lower));
  const triggerFromFiles = (input.files_touched ?? []).some((f) =>
    PRIVATE_PATH_PATTERNS.some((p) => p.test(f)),
  );

  // A caller-declared public destination must never bypass the full analysis,
  // even when its action wording does not match a known verb.
  if (!triggerFromAction && !triggerFromFiles && input.target_visibility !== "public") {
    await audit("risk_assess", "pre_filter_skip", input.proposed_action.slice(0, 100), {
      entity_id: input.entity_id,
    });
    return notAssessed(true);
  }

  // Full analysis
  const p2pReasons = detectPrivateToPublic(input);
  const destructiveReasons = destructive.map((rule) => rule.reason);
  const releaseReasons = detectRelease(lower, input.package_info);
  const externalReasons = detectLocalToExternal(lower);
  const securityReasons = detectSecurity(input);

  const risk_reasons = [...p2pReasons, ...destructiveReasons, ...releaseReasons, ...externalReasons, ...securityReasons];

  // The analysis ran but no detector produced a finding (for example a public
  // target with an unrecognised verb). That is still "not assessed", not "low".
  if (risk_reasons.length === 0) {
    await audit("risk_assess", "not_assessed", input.proposed_action.slice(0, 100), {
      entity_id: input.entity_id,
    });
    return notAssessed(false);
  }

  // Boundary: first non-none wins, in severity order
  let boundary_crossed: BoundaryCrossed = "none";
  if (p2pReasons.length > 0) boundary_crossed = "private_to_public";
  else if (securityReasons.length > 0) boundary_crossed = "security";
  else if (destructiveReasons.length > 0) boundary_crossed = "destructive";
  else if (releaseReasons.length > 0) boundary_crossed = "release";
  else if (externalReasons.length > 0) boundary_crossed = "local_to_external";

  // Reversibility
  let reversibility: Reversibility = "reversible";
  if (boundary_crossed === "private_to_public" || destructive.some((rule) => rule.irreversible)) {
    reversibility = "irreversible";
  } else if (
    destructive.length > 0 ||
    boundary_crossed === "release" ||
    boundary_crossed === "local_to_external" ||
    GIT_PUSH_PATTERN.test(lower)
  ) {
    reversibility = "hard_to_reverse";
  }

  // Risk level
  let risk_level: RiskLevel;
  if (boundary_crossed === "private_to_public") {
    risk_level = "critical";
  } else if (
    boundary_crossed === "security" ||
    (destructive.length > 0 && reversibility === "irreversible")
  ) {
    risk_level = "high";
  } else if (
    boundary_crossed === "release" ||
    boundary_crossed === "local_to_external" ||
    boundary_crossed === "destructive" ||
    reversibility !== "reversible"
  ) {
    risk_level = "medium";
  } else {
    risk_level = "low";
  }

  const requires_confirmation = risk_level === "critical" || risk_level === "high" || reversibility !== "reversible";

  const result: RiskAssessResult = {
    risk_level,
    boundary_crossed,
    reversibility,
    requires_confirmation,
    risk_reasons,
    pre_filter_skipped: false,
  };

  await audit("risk_assess", "assess", `${risk_level}/${boundary_crossed}: ${input.proposed_action.slice(0, 100)}`, {
    entity_id: input.entity_id,
    after: { risk_level, boundary_crossed, reversibility, requires_confirmation },
  });

  return result;
}
