import { audit } from "../utils/audit.js";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type BoundaryCrossed =
  | "none"
  | "private_to_public"
  | "local_to_external"
  | "destructive"
  | "release"
  | "security";
export type Reversibility = "reversible" | "hard_to_reverse" | "irreversible";

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
  // true when the action cleared the pre-filter — guardian checks were not run
  pre_filter_skipped: boolean;
}

// Accept both literal shell commands and clear natural-language descriptions.
// Callers often describe the intended action instead of pasting the exact command.
const GIT_PUSH_PATTERN =
  /\bgit push\b|\bpush(?:es|ed|ing)?\b[^.\n]{0,120}\b(?:branch|commit|tag|repo(?:sitory)?|remote|github)\b|\b(?:branch|commit|tag|repo(?:sitory)?|remote|github)\b[^.\n]{0,120}\bpush(?:es|ed|ing)?\b/i;

// ──────────────────────────────────────────────────────────────────────────────
// Pre-filter: if none of these trigger patterns appear in the proposed action or
// files touched, the action is low-risk and we skip the full guardian analysis.
// Run the guardian on: publish, push, force-push, git tag, git reset --hard,
// git rm, deploy, delete/remove/rm files, external API calls, roadmap/private
// state movement, secrets/config, billing.
// ──────────────────────────────────────────────────────────────────────────────
const TRIGGER_PATTERNS: RegExp[] = [
  /\bnpm publish\b/i,
  GIT_PUSH_PATTERN,
  /\bforce.?push\b/i,
  /push.*--force/i,
  /\bgit tag\b/i,
  /\bgit reset.*--hard\b/i,
  /\bgit rm\b/i,
  /\bdeploy\b/i,
  /\bwrangler (publish|deploy)\b/i,
  /\bdelete.*file\b/i,
  /\bremove.*file\b/i,
  /\brm\s+-rf?\b/i,
  /\boverwrite\b/i,
  /\bdestroy\b/i,
  /\bdrop\s+table\b/i,
  /\btruncate\b/i,
  /\bsend.*email\b/i,
  /\bpost.*api\b/i,
  /\bapi.*call.*post\b/i,
  /\bwebhook\b/i,
  /\bbilling\b/i,
  /\bpayment\b/i,
  /\bcharge\b/i,
  /\bpublic\s+repo\b/i,
  /\bpublic\s+repository\b/i,
  /\broadmap.*public\b/i,
  /\bpublic.*roadmap\b/i,
  /write.*\.env/i,
  /\.env.*write/i,
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

function detectDestructive(lower: string): string[] {
  const patterns: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /\bgit reset.*--hard\b/, reason: "git reset --hard discards uncommitted changes permanently." },
    { pattern: /\bforce.?push\b|push.*--force/, reason: "Force push overwrites remote history and cannot be undone for collaborators." },
    { pattern: /\bgit rm\b/, reason: "git rm removes files from version control history." },
    { pattern: /\bdrop\s+table\b/, reason: "DROP TABLE is irreversible in most databases without a backup." },
    { pattern: /\btruncate\b/, reason: "TRUNCATE removes all rows and cannot be rolled back in some databases." },
    { pattern: /\brm\s+-rf?\b/, reason: "rm -rf recursively deletes files without a confirmation prompt." },
  ];

  return patterns.filter(({ pattern }) => pattern.test(lower)).map(({ reason }) => reason);
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

  return reasons;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

export async function assessRisk(input: RiskAssessInput): Promise<RiskAssessResult> {
  const lower = input.proposed_action.toLowerCase().trim();

  // Pre-filter: skip full guardian if nothing looks risky
  const triggerFromAction = TRIGGER_PATTERNS.some((p) => p.test(lower));
  const triggerFromFiles = (input.files_touched ?? []).some((f) =>
    PRIVATE_PATH_PATTERNS.some((p) => p.test(f)),
  );

  // A caller-declared public destination must never bypass the full analysis,
  // even when its action wording does not match a known verb.
  if (!triggerFromAction && !triggerFromFiles && input.target_visibility !== "public") {
    await audit("risk_assess", "pre_filter_skip", input.proposed_action.slice(0, 100), {
      entity_id: input.entity_id,
    });
    return {
      risk_level: "low",
      boundary_crossed: "none",
      reversibility: "reversible",
      requires_confirmation: false,
      risk_reasons: [],
      pre_filter_skipped: true,
    };
  }

  // Full analysis
  const p2pReasons = detectPrivateToPublic(input);
  const destructiveReasons = detectDestructive(lower);
  const releaseReasons = detectRelease(lower, input.package_info);
  const externalReasons = detectLocalToExternal(lower);
  const securityReasons = detectSecurity(input);

  // Boundary: first non-none wins, in severity order
  let boundary_crossed: BoundaryCrossed = "none";
  if (p2pReasons.length > 0) boundary_crossed = "private_to_public";
  else if (securityReasons.length > 0) boundary_crossed = "security";
  else if (destructiveReasons.length > 0) boundary_crossed = "destructive";
  else if (releaseReasons.length > 0) boundary_crossed = "release";
  else if (externalReasons.length > 0) boundary_crossed = "local_to_external";

  // Reversibility
  let reversibility: Reversibility = "reversible";
  if (
    boundary_crossed === "private_to_public" ||
    /\bgit reset.*--hard\b/.test(lower) ||
    /\btruncate\b/.test(lower) ||
    /\bdrop\s+table\b/.test(lower) ||
    /\brm\s+-rf?\b/.test(lower)
  ) {
    reversibility = "irreversible";
  } else if (
    boundary_crossed === "release" ||
    boundary_crossed === "local_to_external" ||
    GIT_PUSH_PATTERN.test(lower) ||
    /\bgit rm\b/.test(lower) ||
    /\bforce.?push\b|push.*--force/.test(lower)
  ) {
    reversibility = "hard_to_reverse";
  }

  // Risk level
  let risk_level: RiskLevel;
  if (boundary_crossed === "private_to_public") {
    risk_level = "critical";
  } else if (
    boundary_crossed === "security" ||
    (boundary_crossed === "destructive" && reversibility === "irreversible")
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

  const risk_reasons = [...p2pReasons, ...destructiveReasons, ...releaseReasons, ...externalReasons, ...securityReasons];
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
