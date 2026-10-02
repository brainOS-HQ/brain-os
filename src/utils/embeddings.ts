import { readFile, writeFile, mkdir, rename, unlink } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { getBrainDir } from "./file-store.js";

export type EmbeddingSourceKind = "entity" | "decision" | "pattern" | "session";
export type EmbeddingFacet = "chosen" | "rejected" | "invalidate";

export interface StoredEmbedding {
  id: string;
  source_kind: EmbeddingSourceKind;
  source_id: string;
  facet?: EmbeddingFacet;
  content: string;
  vector: number[];
  provider: "local" | "openai";
  // Added in 0.10.x. Entries written by earlier versions carry neither field;
  // they are assumed to belong to the provider's historical default model and
  // are validated by vector length alone (see classifyEntry).
  model?: string;
  dimensions?: number;
  created_at: string;
}

export interface RecallResult {
  source_kind: string;
  source_id: string;
  content: string;
  similarity: number;
}

/**
 * Why semantic ranking is unavailable or degraded. `index_incomplete` is
 * produced by the recall tool (it needs the canonical record set), the rest by
 * provider initialization / invocation here.
 */
export type EmbeddingsFallbackReason =
  | "not_configured"
  | "local_provider_unavailable"
  | "optional_package_missing"
  | "auth_failed"
  | "provider_error"
  | "index_incomplete";

// --- Provider abstraction ---

type EmbedFn = (text: string) => Promise<number[] | null>;

export interface EmbeddingsProvider {
  name: "local" | "openai";
  model: string;
  dimensions: number;
  embed: EmbedFn;
}

type OpenAIClient = {
  embeddings: {
    create(input: {
      model: string;
      input: string;
      dimensions: number;
    }): Promise<{ data: Array<{ embedding: number[] }> }>;
  };
};

type OpenAIConstructor = new (options: {
  apiKey: string;
  timeout?: number;
  maxRetries?: number;
}) => OpenAIClient;

export class EmbeddingsNotConfiguredError extends Error {
  readonly reason: EmbeddingsFallbackReason;
  constructor(reason: string, kind: EmbeddingsFallbackReason = "not_configured") {
    super(reason);
    this.name = "EmbeddingsNotConfiguredError";
    this.reason = kind;
  }
}

/**
 * A provider call failed at runtime (auth, network, quota...). The message is
 * ALWAYS sanitized: provider SDKs echo request details — OpenAI's 401 text
 * includes a masked copy of the key — and this error can end up in tool
 * output or audit records, so the raw message never leaves this module.
 */
export class EmbeddingsProviderError extends Error {
  readonly reason: "auth_failed" | "provider_error";
  constructor(reason: "auth_failed" | "provider_error", message: string) {
    super(message);
    this.name = "EmbeddingsProviderError";
    this.reason = reason;
  }
}

const OPENAI_PROVIDER_PACKAGE = "openai";
const OPENAI_MODEL = "text-embedding-3-small";
const OPENAI_DIMENSIONS = 384;
const OPENAI_TIMEOUT_MS = 20_000;

// Legacy entries (no `model` field) were only ever produced by these models.
const LEGACY_DEFAULT_MODEL: Record<StoredEmbedding["provider"], string> = {
  openai: OPENAI_MODEL,
  local: "Xenova/all-MiniLM-L6-v2",
};

const CONFIG_HINT =
  "Embeddings are optional and are not installed with brain-os. Install the OpenAI provider beside brain-os, then configure it:\n" +
  `  npm install ${OPENAI_PROVIDER_PACKAGE}\n` +
  '  "env": { "BRAIN_EMBEDDINGS": "openai", "OPENAI_API_KEY": "${OPENAI_API_KEY}" }\n' +
  "  (BRAIN_EMBEDDINGS=local is temporarily unavailable pending an audited provider.)\n" +
  "Then restart your MCP client. Other tools (entity_update, decision_log, etc.) work without embeddings.";

let activeProvider: EmbeddingsProvider | null = null;
let initError: string | null = null;
let initReason: EmbeddingsFallbackReason | null = null;
let initPromise: Promise<void> | null = null;
let providerOverride: EmbeddingsProvider | null | undefined = undefined;

function isMissingOptionalProvider(error: unknown, packageName: string): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "ERR_MODULE_NOT_FOUND" &&
    typeof candidate.message === "string" &&
    candidate.message.includes(packageName);
}

async function initProvider(): Promise<void> {
  const mode = process.env.BRAIN_EMBEDDINGS?.toLowerCase().trim();

  if (!mode) {
    activeProvider = null;
    initReason = "not_configured";
    initError = `BRAIN_EMBEDDINGS not set. ${CONFIG_HINT}`;
    return;
  }

  if (mode === "openai") {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      activeProvider = null;
      initReason = "not_configured";
      initError = "BRAIN_EMBEDDINGS=openai requires OPENAI_API_KEY in the MCP server env.";
      return;
    }
    try {
      const providerModule = await import(OPENAI_PROVIDER_PACKAGE) as {
        default: OpenAIConstructor;
      };
      const OpenAI = providerModule.default;
      const client = new OpenAI({ apiKey: openaiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: 1 });
      activeProvider = {
        name: "openai",
        model: OPENAI_MODEL,
        dimensions: OPENAI_DIMENSIONS,
        embed: async (text: string) => {
          const res = await client.embeddings.create({
            model: OPENAI_MODEL,
            input: text.slice(0, 30000),
            dimensions: OPENAI_DIMENSIONS,
          });
          return res.data[0].embedding;
        },
      };
      // Security reminder (stderr only — never touches the JSON-RPC stdout stream).
      // We can't tell whether the key was pasted inline or referenced from the shell
      // (both arrive via process.env), so this is a nudge, not a hard check.
      process.stderr.write(
        "Brain OS: OpenAI embeddings active. Keep OPENAI_API_KEY out of plaintext config — " +
          'reference it as "${OPENAI_API_KEY}" in your MCP env.\n'
      );
    } catch (e) {
      activeProvider = null;
      if (isMissingOptionalProvider(e, OPENAI_PROVIDER_PACKAGE)) {
        initReason = "optional_package_missing";
        initError = `BRAIN_EMBEDDINGS=openai requires the optional peer "${OPENAI_PROVIDER_PACKAGE}". Install it beside brain-os with: npm install ${OPENAI_PROVIDER_PACKAGE}`;
      } else {
        initReason = "provider_error";
        initError = `Failed to initialize OpenAI embeddings (${describeErrorShape(e)}).`;
      }
    }
    return;
  }

  if (mode === "local") {
    // The latest @huggingface/transformers release still installs unresolved
    // High-severity sharp/libvips and adm-zip advisories. Keep local mode
    // fail-closed until an audited provider is available. Nothing is imported.
    activeProvider = null;
    initReason = "local_provider_unavailable";
    initError =
      "BRAIN_EMBEDDINGS=local is temporarily unavailable because its former provider " +
      "has unresolved High-severity transitive vulnerabilities. Use BRAIN_EMBEDDINGS=openai " +
      "or keyword recall until an audited local provider is available.";
    return;
  }

  activeProvider = null;
  initReason = "not_configured";
  initError = `Unknown BRAIN_EMBEDDINGS value: "${mode}". Use "openai"; local mode is temporarily unavailable.`;
}

async function getProvider(): Promise<EmbeddingsProvider | null> {
  if (providerOverride !== undefined) return providerOverride;
  if (!initPromise) initPromise = initProvider();
  await initPromise;
  return activeProvider;
}

async function getInitError(): Promise<string | null> {
  if (providerOverride !== undefined) {
    return providerOverride ? null : "Embeddings provider not configured.";
  }
  if (!initPromise) initPromise = initProvider();
  await initPromise;
  return initError;
}

/**
 * TEST HOOK. Replace the provider in-process so tests can simulate a working,
 * failing, or absent provider without network access or an installed SDK.
 * `null` simulates "no provider"; `undefined` restores env-driven resolution.
 * There is deliberately no environment-variable form of this hook: a provider
 * must never be loadable from an attacker-controlled module path.
 */
export function setEmbeddingsProviderOverride(provider: EmbeddingsProvider | null | undefined): void {
  providerOverride = provider;
  providerMismatchWarned = false;
  providerFailureWarned = false;
}

/** TEST HOOK. Forget the cached env-driven provider so BRAIN_EMBEDDINGS can be re-read. */
export function resetEmbeddingsProviderForTests(): void {
  providerOverride = undefined;
  activeProvider = null;
  initError = null;
  initReason = null;
  initPromise = null;
  providerMismatchWarned = false;
  providerFailureWarned = false;
}

// --- Error sanitization ---

const KEY_SHAPED = /\b(sk|sk-ant|sk-proj)-[A-Za-z0-9_*-]{4,}/g;

/** Error class name + HTTP status only. Never the raw message. */
function describeErrorShape(e: unknown): string {
  if (!e || typeof e !== "object") return "unknown error";
  const err = e as { name?: unknown; status?: unknown; code?: unknown };
  const parts: string[] = [];
  if (typeof err.name === "string" && err.name && err.name !== "Error") {
    parts.push(err.name.replace(KEY_SHAPED, "[redacted]").slice(0, 60));
  }
  if (typeof err.status === "number") parts.push(`status ${err.status}`);
  else if (typeof err.code === "string") parts.push(`code ${err.code.replace(KEY_SHAPED, "[redacted]").slice(0, 40)}`);
  return parts.length ? parts.join(", ") : "unknown error";
}

/**
 * Classify a raw provider failure into a fallback reason and build a message
 * that is safe to show, store, and audit. Only the error's class name and HTTP
 * status are retained; the raw message is inspected, never copied.
 */
export function sanitizeProviderError(e: unknown): EmbeddingsProviderError {
  if (e instanceof EmbeddingsProviderError) return e;
  const err = (e && typeof e === "object" ? e : {}) as { status?: unknown; message?: unknown; name?: unknown };
  const status = typeof err.status === "number" ? err.status : undefined;
  const rawMessage = typeof err.message === "string" ? err.message : "";
  const authShaped = /incorrect api key|invalid api key|invalid_api_key|authentication|unauthorized/i.test(rawMessage)
    || /AuthenticationError|PermissionDeniedError/.test(typeof err.name === "string" ? err.name : "");
  if (status === 401 || status === 403 || authShaped) {
    return new EmbeddingsProviderError(
      "auth_failed",
      `Embeddings provider rejected the credential (${describeErrorShape(e)}). ` +
        "Check OPENAI_API_KEY in the MCP server env. Lexical recall continues to work.",
    );
  }
  return new EmbeddingsProviderError(
    "provider_error",
    `Embeddings provider request failed (${describeErrorShape(e)}). Lexical recall continues to work.`,
  );
}

let providerFailureWarned = false;

async function embedWithProvider(provider: EmbeddingsProvider, text: string): Promise<number[] | null> {
  try {
    return await provider.embed(text);
  } catch (e) {
    const sanitized = sanitizeProviderError(e);
    if (!providerFailureWarned) {
      providerFailureWarned = true;
      // stderr only; sanitized message.
      console.error(`[brain-os] ${sanitized.message}`);
    }
    throw sanitized;
  }
}

// --- Storage ---

function getEmbeddingsPath(): string {
  return join(getBrainDir(), "embeddings.json");
}

let providerMismatchWarned = false;

function warnOnProviderMismatch(total: number, compatible: number, active: string): void {
  if (providerMismatchWarned) return;
  if (compatible === total) return;
  const lost = total - compatible;
  providerMismatchWarned = true;
  // stderr is safe in MCP stdio (only stdout carries protocol)
  console.error(
    `[brain-os] Embeddings index mismatch: ${lost} of ${total} stored vectors were ` +
    `generated by a different provider/model/dimension and are invisible to the active "${active}" provider. ` +
    `Run \`brain-os embeddings rebuild --dry-run\` to preview a rebuild.`
  );
}

/** Read the raw stored index. Malformed files read as empty. */
export async function loadEmbeddingsIndex(): Promise<StoredEmbedding[]> {
  const path = getEmbeddingsPath();
  if (!existsSync(path)) return [];
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredEmbedding[]) : [];
  } catch {
    return [];
  }
}

/**
 * Atomically replace the whole index: serialize to a same-directory tmp file,
 * then rename. Readers never observe a partial file; a crash leaves the old
 * index intact.
 */
export async function replaceEmbeddingsIndex(embeddings: StoredEmbedding[]): Promise<string> {
  const dir = getBrainDir();
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const finalPath = getEmbeddingsPath();
  const rand = Math.random().toString(36).slice(2, 10);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}-${rand}`;
  try {
    await writeFile(tmpPath, JSON.stringify(embeddings), "utf-8");
    await rename(tmpPath, finalPath);
  } catch (e) {
    // Best-effort cleanup if write succeeded but rename failed
    try { await unlink(tmpPath); } catch { /* ignore */ }
    throw e;
  }
  return finalPath;
}

// --- Index validation ---

export type EntryCompatibility = "compatible" | "incompatible";

/**
 * Decide whether a stored vector may be compared against the active provider's
 * query vector. Provider, model, and dimension must all agree, and every
 * component must be a finite number. Legacy entries without a model field are
 * assumed to be the provider's historical default model; a credential rotation
 * changes none of these fields, so it never invalidates the index.
 */
export function classifyEntry(entry: StoredEmbedding, provider: Pick<EmbeddingsProvider, "name" | "model" | "dimensions">): EntryCompatibility {
  if (!entry || typeof entry !== "object") return "incompatible";
  if (entry.provider !== provider.name) return "incompatible";
  const model = entry.model ?? LEGACY_DEFAULT_MODEL[entry.provider];
  if (model !== provider.model) return "incompatible";
  if (!Array.isArray(entry.vector) || entry.vector.length !== provider.dimensions) return "incompatible";
  if (entry.dimensions !== undefined && entry.dimensions !== provider.dimensions) return "incompatible";
  for (const x of entry.vector) {
    if (typeof x !== "number" || !Number.isFinite(x)) return "incompatible";
  }
  return "compatible";
}

// --- Core functions ---

export async function embedText(text: string): Promise<number[] | null> {
  const provider = await getProvider();
  if (!provider) return null;
  try {
    return await embedWithProvider(provider, text);
  } catch {
    return null;
  }
}

/**
 * Like embedText but surfaces failures: throws EmbeddingsNotConfiguredError
 * when no provider is ready and a sanitized EmbeddingsProviderError when the
 * provider call fails. Used by the explicit rebuild, which must abort loudly.
 */
export async function embedTextStrict(text: string): Promise<number[] | null> {
  const provider = await getProvider();
  if (!provider) {
    const reason = (await getInitError()) ?? "Embeddings provider not configured.";
    throw new EmbeddingsNotConfiguredError(reason, initReason ?? "not_configured");
  }
  return embedWithProvider(provider, text);
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  const sim = dot / (Math.sqrt(magA) * Math.sqrt(magB));
  return Number.isFinite(sim) ? sim : 0;
}

export function buildStoredEmbedding(
  sourceKind: EmbeddingSourceKind,
  sourceId: string,
  content: string,
  vector: number[],
  provider: Pick<EmbeddingsProvider, "name" | "model" | "dimensions">,
  facet?: EmbeddingFacet,
): StoredEmbedding {
  return {
    id: facet ? `${sourceKind}-${sourceId}-${facet}` : `${sourceKind}-${sourceId}`,
    source_kind: sourceKind,
    source_id: sourceId,
    facet,
    content: content.slice(0, 2000),
    vector,
    provider: provider.name,
    model: provider.model,
    dimensions: provider.dimensions,
    created_at: new Date().toISOString(),
  };
}

export async function embedAndStore(
  sourceKind: EmbeddingSourceKind,
  sourceId: string,
  content: string,
  facet?: EmbeddingFacet
): Promise<void> {
  const provider = await getProvider();
  if (!provider) return;

  const vector = await embedWithProvider(provider, content.slice(0, 8000));
  if (!vector) return;

  const all = await loadEmbeddingsIndex();

  const existing = all.findIndex(
    (e) => e.source_kind === sourceKind && e.source_id === sourceId && e.facet === facet
  );

  const entry = buildStoredEmbedding(sourceKind, sourceId, content, vector, provider, facet);

  if (existing >= 0) {
    all[existing] = entry;
  } else {
    all.push(entry);
  }

  await replaceEmbeddingsIndex(all);
}

export interface SemanticSearchOptions {
  k?: number;
  threshold?: number;
  sourceKind?: string;
  facet?: EmbeddingFacet;
  /**
   * Optional predicate: entries whose source is no longer current (archived,
   * superseded, deleted) are dropped before ranking and counted as `stale`.
   * Kinds the predicate cannot judge should return true.
   */
  isCurrent?: (sourceKind: EmbeddingSourceKind, sourceId: string) => boolean;
}

export interface SemanticIndexStats {
  /** Stored entries after the source_kind / facet filter. */
  eligible: number;
  /** Eligible entries whose provider+model+dimension match the active provider. */
  compatible: number;
  /** Eligible entries that cannot be compared (wrong provider/model/dimension, non-finite). */
  incompatible: number;
  /** Eligible entries whose source record is no longer current. Ignored. */
  stale: number;
}

export interface SemanticSearchOutcome {
  results: RecallResult[];
  index: SemanticIndexStats;
  /** Distinct (source_kind, source_id) pairs with at least one compatible, current vector. */
  covered: Array<{ source_kind: EmbeddingSourceKind; source_id: string }>;
}

export interface IndexInspection extends SemanticSearchOutcome {
  /** Entries that may be compared against the active provider. */
  usable: StoredEmbedding[];
}

/**
 * Validate the stored index against the active provider WITHOUT any network
 * call. Safe to run when no provider is ready: compatibility is then unknown,
 * so `compatible` and `incompatible` are both 0 and only `eligible` / `stale`
 * are reported.
 */
export async function inspectEmbeddingsIndex(options?: Pick<SemanticSearchOptions, "sourceKind" | "facet" | "isCurrent">): Promise<IndexInspection> {
  const provider = await getProvider();
  const all = await loadEmbeddingsIndex();
  const eligible = all
    .filter((e) => e && typeof e === "object")
    .filter((e) => !options?.sourceKind || e.source_kind === options.sourceKind)
    .filter((e) => {
      if (options?.facet === undefined) return true;
      // Unfaceted legacy entries treated as "chosen" for back-compat
      const entryFacet = e.facet ?? "chosen";
      return entryFacet === options.facet;
    });

  let stale = 0;
  let incompatible = 0;
  const usable: StoredEmbedding[] = [];
  for (const e of eligible) {
    if (options?.isCurrent && !options.isCurrent(e.source_kind, e.source_id)) {
      stale += 1;
      continue;
    }
    if (!provider) continue;
    if (classifyEntry(e, provider) !== "compatible") {
      incompatible += 1;
      continue;
    }
    usable.push(e);
  }

  if (provider) {
    // Warn once per session if the user switched providers/models and silently
    // lost access to prior embeddings. Vectors from different models are not
    // comparable, so we can't transparently merge them — but the user should know.
    warnOnProviderMismatch(eligible.length - stale, usable.length, provider.name);
  }

  const coveredKeys = new Set<string>();
  const covered: SemanticSearchOutcome["covered"] = [];
  for (const e of usable) {
    const key = `${e.source_kind}\u0000${e.source_id}`;
    if (!coveredKeys.has(key)) {
      coveredKeys.add(key);
      covered.push({ source_kind: e.source_kind, source_id: e.source_id });
    }
  }

  return {
    results: [],
    index: { eligible: eligible.length, compatible: usable.length, incompatible, stale },
    covered,
    usable,
  };
}

/**
 * Semantic search with full index accounting. Throws
 * EmbeddingsNotConfiguredError when no provider is ready and
 * EmbeddingsProviderError (sanitized) when the provider call fails.
 * Pass a prior `inspection` to avoid re-reading the index.
 */
export async function semanticSearch(
  query: string,
  options?: SemanticSearchOptions,
  inspection?: IndexInspection,
): Promise<SemanticSearchOutcome> {
  const k = options?.k ?? 5;
  const threshold = options?.threshold ?? 0.3;
  const provider = await getProvider();
  if (!provider) {
    const reason = (await getInitError()) ?? "Embeddings provider not configured.";
    throw new EmbeddingsNotConfiguredError(reason, initReason ?? "not_configured");
  }

  const inspected = inspection ?? await inspectEmbeddingsIndex(options);
  const { usable, index, covered } = inspected;

  if (usable.length === 0) return { results: [], index, covered };

  // The external call happens only after the index proved usable — an empty
  // or wholly incompatible index never triggers a network request.
  const queryVec = await embedWithProvider(provider, query);
  if (!queryVec || queryVec.length !== provider.dimensions) return { results: [], index, covered };

  const scored = usable
    .map((e) => ({
      source_kind: e.source_kind,
      source_id: e.source_id,
      content: e.content,
      similarity: cosine(queryVec, e.vector),
    }))
    .filter((e) => e.similarity >= threshold)
    .sort((a, b) =>
      b.similarity - a.similarity
      || a.source_kind.localeCompare(b.source_kind)
      || a.source_id.localeCompare(b.source_id))
    .slice(0, k);

  return { results: scored, index, covered };
}

export async function semanticRecall(
  query: string,
  options?: SemanticSearchOptions
): Promise<RecallResult[]> {
  const outcome = await semanticSearch(query, options);
  return outcome.results;
}

export interface ProviderState {
  /** BRAIN_EMBEDDINGS is set to any value. */
  configured: boolean;
  configured_mode: string | null;
  /** A provider initialized and can embed. */
  ready: boolean;
  name: string;
  model: string | null;
  dimensions: number | null;
  reason?: EmbeddingsFallbackReason;
  message?: string;
}

export async function getProviderState(): Promise<ProviderState> {
  const provider = await getProvider();
  const configured = process.env.BRAIN_EMBEDDINGS?.toLowerCase().trim() ?? null;
  if (provider) {
    return {
      configured: providerOverride !== undefined ? true : configured !== null,
      configured_mode: configured,
      ready: true,
      name: provider.name,
      model: provider.model,
      dimensions: provider.dimensions,
    };
  }
  const message = (await getInitError()) ?? "Not initialized";
  const reason: EmbeddingsFallbackReason = providerOverride === null
    ? "not_configured"
    : (initReason ?? "not_configured");
  return {
    configured: configured !== null,
    configured_mode: configured,
    ready: false,
    name: "none",
    model: null,
    dimensions: null,
    reason,
    message,
  };
}

/** Back-compat shape used by older callers. Prefer getProviderState(). */
export async function getProviderInfo(): Promise<{
  provider: string;
  ready: boolean;
  configured_mode: string | null;
  error?: string;
}> {
  const state = await getProviderState();
  return state.ready
    ? { provider: state.name, ready: true, configured_mode: state.configured_mode }
    : { provider: "none", ready: false, configured_mode: state.configured_mode, error: state.message };
}

// --- Convenience: embed structured data ---
// The text builders are exported so `brain-os embeddings rebuild` indexes
// exactly what the write paths index.

export function entityEmbeddingText(entity: Record<string, unknown>): string {
  const parts = [
    entity.name,
    entity.status,
    entity.next_move,
    entity.last_decision,
    entity.evidence_of_progress,
    ...(Array.isArray(entity.open_questions) ? entity.open_questions : []),
  ].filter(Boolean);
  return parts.join(" | ");
}

export function decisionEmbeddingTexts(decision: Record<string, unknown>): Array<{ facet: EmbeddingFacet; text: string }> {
  const out: Array<{ facet: EmbeddingFacet; text: string }> = [];
  const chosenParts = [
    decision.decision,
    decision.why,
    decision.chosen_direction,
    decision.proof_action,
  ].filter(Boolean);
  out.push({ facet: "chosen", text: chosenParts.join(" | ") });

  const alternatives = decision.alternatives as Array<{ option: string; rejected_because: string }> | undefined;
  if (alternatives?.length) {
    out.push({ facet: "rejected", text: alternatives.map((a) => `${a.option}: ${a.rejected_because}`).join(" | ") });
  }

  // Invalidation conditions ("what would make this false"). decision_check
  // matches proposed actions against this facet to nominate the decision for
  // review — the opposite of a rejected-alternative conflict.
  const invalidateIf = decision.invalidate_if as string[] | undefined;
  if (invalidateIf?.length) {
    out.push({ facet: "invalidate", text: invalidateIf.join(" | ") });
  }
  return out;
}

export function patternEmbeddingText(pattern: Record<string, unknown>): string {
  const parts = [
    pattern.name,
    pattern.interpretation,
    pattern.risk,
    pattern.recommendation,
    ...(Array.isArray(pattern.evidence) ? pattern.evidence : []),
  ].filter(Boolean);
  return parts.join(" | ");
}

export async function embedEntity(entityId: string, entity: Record<string, unknown>): Promise<void> {
  await embedAndStore("entity", entityId, entityEmbeddingText(entity));
}

export async function embedDecision(decisionId: string, decision: Record<string, unknown>): Promise<void> {
  for (const { facet, text } of decisionEmbeddingTexts(decision)) {
    await embedAndStore("decision", decisionId, text, facet);
  }
}

export async function embedPattern(patternId: string, pattern: Record<string, unknown>): Promise<void> {
  await embedAndStore("pattern", patternId, patternEmbeddingText(pattern));
}

export async function embedSession(sessionId: string, summary: string): Promise<void> {
  await embedAndStore("session", sessionId, summary);
}
