import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { sanitizedGitEnv } from "./project-evidence-scan.js";

export const OPERATIONAL_STATE_KEYS = [
  "package.name",
  "package.version",
  "repository.branch",
  "repository.head",
] as const;

export type OperationalStateKey = (typeof OPERATIONAL_STATE_KEYS)[number];

export interface StateClaim {
  key: OperationalStateKey;
  value: string;
  observed_at?: string;
  freshness_ttl_seconds?: number;
  evidence?: string;
}

export interface DesiredState {
  key: OperationalStateKey;
  value: string;
  why?: string;
}

export interface DecisionContext {
  id?: string;
  summary: string;
}

export interface OperationalStateCheckInput {
  root_path: string;
  claims?: StateClaim[];
  desired_state?: DesiredState[];
  decision_context?: DecisionContext[];
}

export type CheckStatus =
  | "verified"
  | "drift"
  | "stale"
  | "conflict"
  | "unavailable"
  | "observed_only";

export interface OperationalStateObservation {
  key: OperationalStateKey;
  observed_value: string | null;
  source: string;
  evidence_pointer: string;
  observed_at: string;
  freshness: "live_at_check" | "unavailable";
  status: CheckStatus;
  claimed_values: string[];
  claim_evidence: string[];
  claim_freshness: "fresh" | "stale" | "unknown" | "not_provided" | "conflict";
  desired_values: string[];
  desired_reasons: string[];
  desired_status: "satisfied" | "unmet" | "not_provided" | "conflict" | "unavailable";
  explanation: string;
  suggested_reconciliation: string | null;
}

export interface OperationalStateCheckResult {
  schema_version: 1;
  mode: "ephemeral_read_only";
  root_path: string;
  checked_at: string;
  writes: "none";
  allowlisted_keys: readonly OperationalStateKey[];
  summary: Record<CheckStatus, number>;
  observations: OperationalStateObservation[];
  decision_context: Array<DecisionContext & { classification: "human_judgment_not_verified" }>;
  warnings: string[];
}

interface CheckOptions {
  now?: Date;
}

const MAX_VALUE_LENGTH = 512;
const MAX_CONTEXT_LENGTH = 500;
const MAX_ITEMS = 12;
const MAX_PACKAGE_JSON_BYTES = 1_000_000;

function assertBoundedInput(input: OperationalStateCheckInput): void {
  if ((input.claims?.length ?? 0) > MAX_ITEMS) {
    throw new Error(`claims is bounded to ${MAX_ITEMS} items`);
  }
  if ((input.desired_state?.length ?? 0) > MAX_ITEMS) {
    throw new Error(`desired_state is bounded to ${MAX_ITEMS} items`);
  }
  if ((input.decision_context?.length ?? 0) > MAX_ITEMS) {
    throw new Error(`decision_context is bounded to ${MAX_ITEMS} items`);
  }

  for (const claim of input.claims ?? []) {
    if (claim.value.length > MAX_VALUE_LENGTH) throw new Error(`claim value for ${claim.key} is too long`);
    if (claim.evidence && claim.evidence.length > MAX_CONTEXT_LENGTH) {
      throw new Error(`claim evidence for ${claim.key} is too long`);
    }
    if (claim.freshness_ttl_seconds !== undefined) {
      if (!claim.observed_at) {
        throw new Error(`claim ${claim.key} needs observed_at when freshness_ttl_seconds is set`);
      }
      if (!Number.isFinite(claim.freshness_ttl_seconds) || claim.freshness_ttl_seconds <= 0) {
        throw new Error(`claim ${claim.key} has an invalid freshness_ttl_seconds`);
      }
    }
    if (claim.observed_at && !Number.isFinite(Date.parse(claim.observed_at))) {
      throw new Error(`claim ${claim.key} has an invalid observed_at timestamp`);
    }
  }
  for (const desired of input.desired_state ?? []) {
    if (desired.value.length > MAX_VALUE_LENGTH) throw new Error(`desired value for ${desired.key} is too long`);
    if (desired.why && desired.why.length > MAX_CONTEXT_LENGTH) {
      throw new Error(`desired-state reason for ${desired.key} is too long`);
    }
  }
  for (const decision of input.decision_context ?? []) {
    if (decision.summary.length > MAX_CONTEXT_LENGTH) throw new Error("decision summary is too long");
    if (decision.id && decision.id.length > 120) throw new Error("decision id is too long");
  }
}

function isContained(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function readPackage(root: string): { name: string; version: string } {
  const packagePath = realpathSync(join(root, "package.json"));
  if (!isContained(root, packagePath)) {
    throw new Error("package.json resolves outside root_path");
  }
  if (statSync(packagePath).size > MAX_PACKAGE_JSON_BYTES) {
    throw new Error(`package.json exceeds the ${MAX_PACKAGE_JSON_BYTES}-byte read limit`);
  }
  const raw = readFileSync(packagePath, "utf8");
  const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
  if (typeof parsed.name !== "string" || typeof parsed.version !== "string") {
    throw new Error("package.json must contain string name and version fields");
  }
  if (parsed.name.length > MAX_VALUE_LENGTH || parsed.version.length > MAX_VALUE_LENGTH) {
    throw new Error(`package.json name/version exceeds the ${MAX_VALUE_LENGTH}-character output limit`);
  }
  return { name: parsed.name, version: parsed.version };
}

function git(root: string, args: string[]): string {
  const output = execFileSync("git", ["--no-optional-locks", "-C", root, ...args], {
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "ignore"],
    env: sanitizedGitEnv(),
  }).trim();
  if (output.length > MAX_VALUE_LENGTH) {
    throw new Error(`Git observation exceeds the ${MAX_VALUE_LENGTH}-character output limit`);
  }
  return output;
}

function uniqueValues<T extends { value: string }>(items: T[]): string[] {
  return [...new Set(items.map((item) => item.value))];
}

function claimFreshness(claims: StateClaim[], now: Date): OperationalStateObservation["claim_freshness"] {
  if (claims.length === 0) return "not_provided";
  if (uniqueValues(claims).length > 1) return "conflict";

  let sawFreshnessRule = false;
  for (const claim of claims) {
    if (claim.observed_at && claim.freshness_ttl_seconds !== undefined) {
      sawFreshnessRule = true;
      const ageMs = now.getTime() - Date.parse(claim.observed_at);
      if (ageMs > claim.freshness_ttl_seconds * 1000) return "stale";
    }
  }
  return sawFreshnessRule ? "fresh" : "unknown";
}

function explain(
  observed: string | null,
  claimed: string[],
  desired: string[],
  freshness: OperationalStateObservation["claim_freshness"],
): Pick<OperationalStateObservation, "status" | "desired_status" | "explanation" | "suggested_reconciliation"> {
  const claimConflict = claimed.length > 1;
  const desiredConflict = desired.length > 1;

  if (observed === null) {
    return {
      status: "unavailable",
      desired_status: "unavailable",
      explanation: "The allowlisted authoritative source could not be read.",
      suggested_reconciliation: "Restore or inspect the named source, then run the read-only check again.",
    };
  }
  if (claimConflict || desiredConflict) {
    return {
      status: "conflict",
      desired_status: desiredConflict ? "conflict" : desired.length === 0 ? "not_provided" : observed === desired[0] ? "satisfied" : "unmet",
      explanation: "More than one distinct value was supplied for the same layer; no winner was selected.",
      suggested_reconciliation: "Review the conflicting inputs and choose the authoritative claim or desired value manually.",
    };
  }

  const desiredStatus: OperationalStateObservation["desired_status"] =
    desired.length === 0 ? "not_provided" : observed === desired[0] ? "satisfied" : "unmet";

  if (freshness === "stale") {
    return {
      status: "stale",
      desired_status: desiredStatus,
      explanation: "The supplied claim exceeded its freshness TTL; the live observation is reported separately.",
      suggested_reconciliation: "Review the evidence and refresh the claim through the normal human-governed workflow.",
    };
  }
  if (claimed.length === 0) {
    return {
      status: "observed_only",
      desired_status: desiredStatus,
      explanation: "A live value was observed, but no claimed state was supplied for comparison.",
      suggested_reconciliation: "If this fact is worth tracking, propose it separately; this check will not persist it.",
    };
  }
  if (observed !== claimed[0]) {
    return {
      status: "drift",
      desired_status: desiredStatus,
      explanation: "The independently observed value differs from the supplied claim.",
      suggested_reconciliation: "Review the evidence and update or reject the claim manually; no change was applied.",
    };
  }
  return {
    status: "verified",
    desired_status: desiredStatus,
    explanation: "The supplied claim matches the independently observed value.",
    suggested_reconciliation: null,
  };
}

export function checkOperationalState(
  input: OperationalStateCheckInput,
  options: CheckOptions = {},
): OperationalStateCheckResult {
  assertBoundedInput(input);

  const candidateRoot = resolve(input.root_path);
  if (!existsSync(candidateRoot) || !statSync(candidateRoot).isDirectory()) {
    throw new Error(`root_path does not exist or is not a directory: ${candidateRoot}`);
  }
  const root = realpathSync(candidateRoot);
  const now = options.now ?? new Date();
  const checkedAt = now.toISOString();
  const warnings: string[] = [];

  let packageData: { name: string; version: string } | null = null;
  let packageError: string | null = null;
  try {
    packageData = readPackage(root);
  } catch (error) {
    packageError = error instanceof Error ? error.message : "package.json unavailable";
    warnings.push(`package source unavailable: ${packageError}`);
  }

  const observed = new Map<OperationalStateKey, { value: string | null; source: string; evidence: string }>([
    ["package.name", {
      value: packageData?.name ?? null,
      source: "repository",
      evidence: "package.json#/name",
    }],
    ["package.version", {
      value: packageData?.version ?? null,
      source: "repository",
      evidence: "package.json#/version",
    }],
  ]);

  for (const [key, args, evidence] of [
    ["repository.branch", ["rev-parse", "--abbrev-ref", "HEAD"], "git rev-parse --abbrev-ref HEAD"],
    ["repository.head", ["rev-parse", "HEAD"], "git rev-parse HEAD"],
  ] as const) {
    try {
      observed.set(key, { value: git(root, [...args]), source: "git", evidence });
    } catch {
      observed.set(key, { value: null, source: "git", evidence });
      warnings.push(`${key} unavailable: root_path is not a readable Git worktree`);
    }
  }

  const observations = OPERATIONAL_STATE_KEYS.map((key): OperationalStateObservation => {
    const source = observed.get(key)!;
    const keyClaims = (input.claims ?? []).filter((claim) => claim.key === key);
    const keyDesired = (input.desired_state ?? []).filter((desired) => desired.key === key);
    const claimedValues = uniqueValues(keyClaims);
    const desiredValues = uniqueValues(keyDesired);
    const freshness = claimFreshness(keyClaims, now);
    const comparison = explain(source.value, claimedValues, desiredValues, freshness);
    return {
      key,
      observed_value: source.value,
      source: source.source,
      evidence_pointer: source.evidence,
      observed_at: checkedAt,
      freshness: source.value === null ? "unavailable" : "live_at_check",
      ...comparison,
      claimed_values: claimedValues,
      claim_evidence: [...new Set(keyClaims.map((claim) => claim.evidence).filter((value): value is string => Boolean(value)))],
      claim_freshness: freshness,
      desired_values: desiredValues,
      desired_reasons: [...new Set(keyDesired.map((desired) => desired.why).filter((value): value is string => Boolean(value)))],
    };
  });

  const summary: Record<CheckStatus, number> = {
    verified: 0,
    drift: 0,
    stale: 0,
    conflict: 0,
    unavailable: 0,
    observed_only: 0,
  };
  for (const observation of observations) summary[observation.status]++;

  return {
    schema_version: 1,
    mode: "ephemeral_read_only",
    root_path: root,
    checked_at: checkedAt,
    writes: "none",
    allowlisted_keys: OPERATIONAL_STATE_KEYS,
    summary,
    observations,
    decision_context: (input.decision_context ?? []).map((decision) => ({
      ...decision,
      classification: "human_judgment_not_verified",
    })),
    warnings,
  };
}
