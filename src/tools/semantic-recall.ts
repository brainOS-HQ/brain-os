import type { ToolContext } from "../storage/adapter.js";
import {
  semanticSearch,
  inspectEmbeddingsIndex,
  getProviderState,
  EmbeddingsNotConfiguredError,
  EmbeddingsProviderError,
  type EmbeddingsFallbackReason,
  type EmbeddingSourceKind,
  type RecallResult,
  type SemanticIndexStats,
} from "../utils/embeddings.js";
import {
  lexicalRecall,
  SNIPPET_MAX_CHARS,
  TITLE_MAX_CHARS,
  type CanonicalRecord,
  type LexicalCandidate,
  type LexicalSourceKind,
} from "../recall/lexical.js";
import { reciprocalRankFusion, type RankedItem } from "../recall/fusion.js";

/**
 * semantic_recall — hybrid recall over current canonical state.
 *
 *   1. Lexical candidates are ALWAYS computed through the StorageAdapter
 *      (entities, decisions, patterns; never memories; terminal records excluded).
 *   2. Semantic ranking runs only when a provider is ready and the index has
 *      compatible vectors. Any provider failure degrades to lexical — never [].
 *   3. Lists are fused with reciprocal-rank fusion and deduplicated by
 *      source_kind + source_id.
 *
 * The response states truthfully which mode ran and why it degraded.
 */

export type RecallMode = "hybrid" | "lexical";

export interface RecallHit {
  source_kind: string;
  source_id: string;
  title: string | null;
  snippet: string;
  /** Fused reciprocal-rank score (hybrid) or lexical rank score (lexical). */
  score: number;
  lexical_rank: number | null;
  semantic_rank: number | null;
  similarity: number | null;
}

export interface SemanticRecallInput {
  query: string;
  source_kind?: string;
  max_results?: number;
}

export interface SemanticRecallResult {
  query: string;
  mode: RecallMode;
  degraded: boolean;
  fallback_reason?: EmbeddingsFallbackReason;
  provider: { configured: boolean; ready: boolean; name: string; model: string | null };
  index: SemanticIndexStats & { coverage: { indexed: number; expected: number } };
  results: RecallHit[];
  count: number;
  /** Results were dropped to keep the response under the byte budget. */
  truncated?: boolean;
  /** The query exceeded QUERY_MAX_CHARS and was cut before processing. */
  query_truncated?: boolean;
  message?: string;
}

export const MAX_RESULTS_CAP = 20;
/** Queries longer than this are truncated (and flagged) so the echoed query, the lexical pass, and the embed input stay bounded. */
export const QUERY_MAX_CHARS = 2000;
export const DEFAULT_MAX_RESULTS = 5;
/** Hard ceiling on the serialized tool response. */
export const RESPONSE_BYTE_BUDGET = 16 * 1024;
const RESPONSE_SOFT_BUDGET = 14 * 1024;
const SEMANTIC_THRESHOLD = 0.3;
const LEXICAL_KINDS: LexicalSourceKind[] = ["entity", "decision", "pattern"];
const SEMANTIC_KINDS = new Set<string>(["entity", "decision", "pattern", "session"]);

function key(kind: string, id: string): string {
  return `${kind}\u0000${id}`;
}

function clampMax(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_MAX_RESULTS;
  return Math.max(1, Math.min(MAX_RESULTS_CAP, Math.floor(n)));
}

function clip(text: string, max: number): string {
  const s = (text ?? "").replace(/\s+/g, " ").trim();
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

export async function recallByMeaning(
  input: SemanticRecallInput,
  ctx: ToolContext,
): Promise<SemanticRecallResult> {
  const rawQuery = typeof input.query === "string" ? input.query.trim() : "";
  const queryTruncated = rawQuery.length > QUERY_MAX_CHARS;
  const query = queryTruncated ? rawQuery.slice(0, QUERY_MAX_CHARS) : rawQuery;
  const maxResults = clampMax(input.max_results);
  const sourceKind = input.source_kind?.trim() || undefined;
  if (sourceKind && !SEMANTIC_KINDS.has(sourceKind)) {
    throw new Error(`Invalid source_kind "${sourceKind}". Use one of: entity, decision, pattern, session.`);
  }

  // 1. Lexical candidates — always. Sessions have no canonical listing, so a
  //    session-only query yields no lexical candidates but still loads nothing.
  const lexicalKinds: LexicalSourceKind[] | null = !sourceKind
    ? LEXICAL_KINDS
    : (LEXICAL_KINDS as string[]).includes(sourceKind) ? [sourceKind as LexicalSourceKind] : null;

  let lexical: LexicalCandidate[] = [];
  let records: CanonicalRecord[] = [];
  if (lexicalKinds && query) {
    const out = await lexicalRecall(ctx.storage, query, { kinds: lexicalKinds, limit: maxResults * 4 });
    lexical = out.candidates;
    records = out.records;
  }
  const currentKeys = new Set(records.map((r) => key(r.source_kind, r.source_id)));
  const recordByKey = new Map(records.map((r) => [key(r.source_kind, r.source_id), r] as const));
  const isCurrent = (kind: EmbeddingSourceKind, id: string): boolean => {
    if (kind === "session") return true; // not canonical-listable; cannot judge
    if (lexicalKinds && !lexicalKinds.includes(kind as LexicalSourceKind)) return false;
    return currentKeys.has(key(kind, id));
  };

  const providerState = await getProviderState();
  const provider = {
    configured: providerState.configured,
    ready: providerState.ready,
    name: providerState.name,
    model: providerState.model,
  };

  // 2. Index accounting first (no network), so the response reports the index
  //    truthfully even when the provider call fails afterwards.
  const inspection = await inspectEmbeddingsIndex({ sourceKind, isCurrent });
  const expected = records.length;
  const indexedOf = (covered: typeof inspection.covered) =>
    covered.filter((c) => c.source_kind !== "session" && currentKeys.has(key(c.source_kind, c.source_id))).length;
  let index: SemanticRecallResult["index"] = { ...inspection.index, coverage: { indexed: indexedOf(inspection.covered), expected } };

  // 3. Semantic ranking — only when a provider is ready.
  let semantic: RecallResult[] = [];
  let mode: RecallMode = "lexical";
  let fallbackReason: EmbeddingsFallbackReason | undefined;
  let message: string | undefined;

  if (!providerState.ready) {
    fallbackReason = providerState.reason ?? "not_configured";
    message = providerState.message;
    if (sourceKind === "session") {
      message = "Session recall is semantic-only (sessions are not canonically listable, so there is no lexical fallback). " + (message ?? "");
    }
  } else if (query) {
    try {
      const outcome = await semanticSearch(query, { k: maxResults * 4, threshold: SEMANTIC_THRESHOLD, sourceKind, isCurrent }, inspection);
      mode = "hybrid";
      semantic = outcome.results;
      index = { ...outcome.index, coverage: { indexed: indexedOf(outcome.covered), expected } };
      if (expected > 0 && index.coverage.indexed < expected) {
        fallbackReason = "index_incomplete";
        message =
          `${expected - index.coverage.indexed} of ${expected} current records have no compatible vector; semantic ranking covered the rest. ` +
          "Run `brain-os embeddings rebuild --dry-run` to preview a rebuild.";
      }
    } catch (e) {
      if (e instanceof EmbeddingsProviderError) {
        fallbackReason = e.reason;
        message = e.message;
      } else if (e instanceof EmbeddingsNotConfiguredError) {
        fallbackReason = e.reason;
        message = e.message;
      } else {
        fallbackReason = "provider_error";
        message = "Embeddings provider failed unexpectedly. Lexical recall continues to work.";
      }
      mode = "lexical";
      semantic = [];
    }
  }

  // 3. Fuse + dedupe. Semantic hits may carry several facets per decision;
  //    keep the best similarity per (kind, id).
  const semanticByKey = new Map<string, RecallResult>();
  for (const r of semantic) {
    const k = key(r.source_kind, r.source_id);
    const prev = semanticByKey.get(k);
    if (!prev || r.similarity > prev.similarity) semanticByKey.set(k, r);
  }
  const semanticRanked = Array.from(semanticByKey.values()).sort((a, b) =>
    b.similarity - a.similarity || a.source_kind.localeCompare(b.source_kind) || a.source_id.localeCompare(b.source_id));

  const lexicalList: RankedItem<{ kind: string; id: string }>[] = lexical.map((c) => ({
    key: key(c.source_kind, c.source_id),
    item: { kind: c.source_kind, id: c.source_id },
  }));
  const semanticList: RankedItem<{ kind: string; id: string }>[] = semanticRanked.map((r) => ({
    key: key(r.source_kind, r.source_id),
    item: { kind: r.source_kind, id: r.source_id },
  }));

  const lexicalByKey = new Map(lexical.map((c) => [key(c.source_kind, c.source_id), c] as const));
  const fused = mode === "hybrid"
    ? reciprocalRankFusion([lexicalList, semanticList])
    : reciprocalRankFusion([lexicalList]);

  let results: RecallHit[] = fused.slice(0, maxResults).map((f) => {
    const lex = lexicalByKey.get(f.key);
    const sem = semanticByKey.get(f.key);
    const record = recordByKey.get(f.key);
    const title = record?.title ?? lex?.title ?? null;
    const snippet = lex?.snippet
      ?? (record ? clip(record.fields.find((x) => x && x.trim()) ?? "", SNIPPET_MAX_CHARS) : null)
      ?? clip(sem?.content ?? "", SNIPPET_MAX_CHARS);
    return {
      source_kind: f.item.kind,
      source_id: f.item.id,
      title: title === null ? null : clip(title, TITLE_MAX_CHARS),
      snippet,
      score: f.score,
      lexical_rank: f.ranks[0] ?? null,
      semantic_rank: mode === "hybrid" ? (f.ranks[1] ?? null) : null,
      similarity: sem ? Math.round(sem.similarity * 1000) / 1000 : null,
    };
  });

  const degraded = mode === "lexical" || fallbackReason !== undefined;
  const base: SemanticRecallResult = {
    query,
    ...(queryTruncated ? { query_truncated: true } : {}),
    mode,
    degraded,
    ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
    provider,
    index,
    results,
    count: results.length,
    ...(message ? { message: clip(message, 600) } : {}),
  };

  // 4. Bound the serialized response.
  let truncated = false;
  while (results.length > 0 && Buffer.byteLength(JSON.stringify({ ...base, results, count: results.length, truncated }, null, 2), "utf-8") > RESPONSE_SOFT_BUDGET) {
    results = results.slice(0, -1);
    truncated = true;
  }
  return { ...base, results, count: results.length, ...(truncated ? { truncated: true } : {}) };
}
