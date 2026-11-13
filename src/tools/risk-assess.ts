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
  // When set and it matches, the rule does not apply (for example a dry run).
  unless?: RegExp;
  reason: string;
  irreversible: boolean;
}

const DESTRUCTIVE_TARGETS =
  "(?:\\b(?:databases?|db|tables?|schemas?|buckets?|namespaces?|volumes?|clusters?|folders?|director(?:y|ies)|dirs?|repos?|repositor(?:y|ies)|branch(?:es)?|files?|prod(?:uction)?)\\b|\\.brain\\b)";

// Words that end a verb's direct object ("remove a line FROM the file").
const NOT_AN_OBJECT =
  "(?:from|in|inside|within|of|on|at|to|into|onto|for|with|by|under|off|out|and|or|then|but)\\b";

const DESTRUCTIVE_RULES: DestructiveRule[] = [
  { pattern: /\bgit\s+reset\b.*--hard\b/i, reason: "git reset --hard discards uncommitted changes permanently.", irreversible: true },
  { pattern: /\bforce.?push\b|push.*--force/i, reason: "Force push overwrites remote history and cannot be undone for collaborators.", irreversible: false },
  { pattern: /\bgit\s+rm\b/i, reason: "git rm removes files from version control history.", irreversible: false },
  {
    pattern: /\bgit\s+clean\b/i,
    // -n / --dry-run only lists what would be deleted (also inside a flag group such as -nd).
    unless: /\bgit\s+clean\b[^\n|;&]*\s(?:--dry-run\b|-[a-zA-Z]*n[a-zA-Z]*\b)/,
    reason: "git clean deletes untracked files; Git keeps no copy of them.",
    irreversible: true,
  },
  {
    // `git checkout -- <path>`, `git checkout <ref> -- <path>`, `git checkout .`
    pattern: /\bgit\s+checkout\b[^\n|;&]*\s--(?:\s|$)|\bgit\s+checkout\s+\.(?:\s|$)/i,
    reason: "This discards uncommitted changes in the working tree.",
    irreversible: true,
  },
  { pattern: /\bgit\s+checkout\b[^\n|;&]*\s(?:-f\b|--force\b)/i, reason: "git checkout -f throws away uncommitted changes.", irreversible: true },
  { pattern: /\bgit\s+switch\b[^\n|;&]*\s(?:-f\b|--force\b|--discard-changes\b)/i, reason: "git switch -f / --discard-changes throws away uncommitted changes.", irreversible: true },
  {
    pattern: /\bgit\s+restore\b/i,
    // --staged alone only unstages; with --worktree it also discards the working copy.
    unless: /\bgit\s+restore\b(?=[^\n|;&]*\s(?:--staged\b|-S\b))(?![^\n|;&]*\s(?:--worktree\b|-W\b))/,
    reason: "git restore discards uncommitted changes in the working tree.",
    irreversible: true,
  },
  { pattern: /\bgit\s+branch\b[^\n]*\s(?:-D\b|--delete\s+--force\b|-d\s+--force\b|--force\s+(?:-d|--delete)\b)/, reason: "git branch -D deletes a branch even when its commits are not merged anywhere.", irreversible: false },
  { pattern: /\bgit\s+stash\s+(?:drop|clear)\b/i, reason: "Dropping a stash discards the changes saved in it.", irreversible: false },
  // rm followed by anything: flags with no target ("run rm -rf"), a target, or
  // a target after "--" ("rm -f -- -file").
  { pattern: /\brm\s+\S|\b(?:rmdir|remove-item)\b/i, reason: "rm deletes files permanently, without a confirmation prompt or a trash folder.", irreversible: true },
  { pattern: /\bxargs\b[^\n|;&]*\brm\b/i, reason: "xargs rm deletes every file it is given.", irreversible: true },
  { pattern: /\bfind\b[^\n|;&]*\s-delete\b/i, reason: "find -delete removes every file it matches.", irreversible: true },
  { pattern: /\bunlink\b/i, reason: "unlink deletes a file.", irreversible: true },
  { pattern: /\bshred\b/i, reason: "shred overwrites a file so it cannot be recovered.", irreversible: true },
  { pattern: /\bdd\b[^\n|;&]*\bof=/i, reason: "dd overwrites its output file or device.", irreversible: true },
  { pattern: /\bdrop\s+(?:table|database|schema|column|index|view)\b/i, reason: "DROP TABLE / DATABASE / SCHEMA / COLUMN / INDEX / VIEW is irreversible in most databases without a backup.", irreversible: true },
  { pattern: /\bflush(?:all|db)\b/i, reason: "FLUSHALL / FLUSHDB deletes every key in the data store.", irreversible: true },
  { pattern: /\bdocker\b[^\n|;&]*\bprune\b/i, reason: "docker prune deletes unused containers, images, networks or volumes.", irreversible: true },
  { pattern: /\bhelm\s+(?:uninstall|delete)\b/i, reason: "helm uninstall removes a release and its resources from the cluster.", irreversible: true },
  { pattern: /\btruncate\b/i, reason: "TRUNCATE removes all rows and cannot be rolled back in some databases.", irreversible: true },
  { pattern: /\bdelete\s+from\b/i, reason: "DELETE FROM removes rows; without a backup or an open transaction they are gone.", irreversible: true },
  { pattern: /\bkubectl\s+delete\b/i, reason: "kubectl delete removes live cluster resources.", irreversible: true },
  { pattern: /\bdestroy(?:s|ed|ing)?\b/i, reason: "A destroy action tears down resources and what they hold.", irreversible: true },
  { pattern: /\b(?:wip(?:e|es|ed|ing)|eras(?:e|es|ed|ing)|purg(?:e|es|ed|ing))\b/i, reason: "Wiping, erasing or purging removes data without a way back.", irreversible: true },
  {
    // The target must be the thing deleted: the verb, at most three describing
    // words, then the target. A preposition ends the match, so "remove X from
    // this file" (an edit inside a file) is not a deletion of the file.
    pattern: new RegExp(
      `\\b(?:delet(?:e|es|ed|ing)|remov(?:e|es|ed|ing)|drop(?:s|ped|ping)?)\\s+(?:(?!${NOT_AN_OBJECT})\\S+\\s+){0,3}?${DESTRUCTIVE_TARGETS}`,
      "i",
    ),
    reason: "This deletes or removes files, branches or stored data.",
    irreversible: false,
  },
  {
    // Emptying a container: "remove everything in the data directory",
    // "delete the contents of the prod database". Here the preposition is part
    // of the deletion, so it is required rather than excluded.
    pattern: new RegExp(
      `\\b(?:delet(?:e|es|ed|ing)|remov(?:e|es|ed|ing)|drop(?:s|ped|ping)?)\\s+(?:(?!${NOT_AN_OBJECT})\\S+\\s+){0,2}?` +
        `(?:everything|all|contents?|data|rows|records)\\s+(?:in|of|inside|within)\\s+` +
        `(?:(?!${NOT_AN_OBJECT})\\S+\\s+){0,3}?${DESTRUCTIVE_TARGETS}`,
      "i",
    ),
    reason: "This deletes everything inside a folder, database or other store.",
    irreversible: false,
  },
  { pattern: /\boverwrit(?:e|es|ing)\b|\boverwritten\b/i, reason: "Overwriting replaces existing content.", irreversible: false },
];

// Sending something off this machine with a command-line transfer tool.
const TRANSFER_TOOL = /\b(?:curl|wget|scp|sftp|rsync|ncat|nc|ftp)\b/i;
// Tools whose whole job is copying files or bytes between machines. curl and
// wget are not in this list: a plain GET sends nothing.
const COPY_TOOL = /\b(?:scp|sftp|rsync|ncat|nc|ftp)\b/i;
const TRANSFER_SENDS_DATA_LONG =
  /(?:-X\s*(?:POST|PUT|PATCH)\b|--request\s+(?:POST|PUT|PATCH)\b|--data\b|--form\b|--upload-file\b|--post-(?:data|file)\b)/i;
// Short flags are case-sensitive: curl -d / -F / -T send data, while -D
// (dump headers), -f (fail on error) and -t (telnet option) do not. Tested
// against the action as written, never a lowercased copy.
const TRANSFER_SENDS_DATA_SHORT = /\s-(?:d|F|T)\b/;
const SENSITIVE_IN_ACTION =
  /\.env\b|\bsecrets?\b|\bapi[_-]?keys?\b|\bpasswords?\b|\bcredentials?\b|\bprivate[_-]?key\b|\baccess[_-]?key\b|\bid_rsa\b|\.pem\b|\btokens?\b/i;
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

// True when the command, as written, sends data off this machine.
function sendsData(action: string): boolean {
  return TRANSFER_TOOL.test(action) && (TRANSFER_SENDS_DATA_LONG.test(action) || TRANSFER_SENDS_DATA_SHORT.test(action));
}

function matchDestructive(action: string): DestructiveRule[] {
  return DESTRUCTIVE_RULES.filter(({ pattern, unless }) => pattern.test(action) && !unless?.test(action));
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

function detectLocalToExternal(lower: string, action: string): string[] {
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
  if (sendsData(action)) {
    reasons.push("This command sends data from this machine to another host.");
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
  // A credential word matters only when something is being sent: a GET whose
  // URL happens to contain "token" or ".pem" is a download.
  if (SENSITIVE_IN_ACTION.test(action) && (sendsData(action) || COPY_TOOL.test(action))) {
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
  const externalReasons = detectLocalToExternal(lower, action);
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
