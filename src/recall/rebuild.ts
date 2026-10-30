import type { ToolContext } from "../storage/adapter.js";
import {
  buildStoredEmbedding,
  classifyEntry,
  decisionEmbeddingTexts,
  embedTextStrict,
  entityEmbeddingText,
  getProviderState,
  loadEmbeddingsIndex,
  patternEmbeddingText,
  replaceEmbeddingsIndex,
  sanitizeProviderError,
  type EmbeddingFacet,
  type EmbeddingSourceKind,
  type ProviderState,
  type StoredEmbedding,
} from "../utils/embeddings.js";
import { isCurrentDecision, isCurrentEntity, isCurrentPattern } from "./lexical.js";

/**
 * Explicit, atomic rebuild of the embeddings index from CURRENT canonical
 * state. Never runs automatically — only `brain-os embeddings rebuild`.
 *
 * Plan first (no I/O beyond reading state), show the item count, and only then
 * call the provider. Writes are all-or-nothing: the new index is serialized to
 * a temp file and renamed over the old one; any provider failure aborts with
 * the old index untouched.
 */

export interface RebuildItem {
  source_kind: Exclude<EmbeddingSourceKind, "session">;
  source_id: string;
  facet?: EmbeddingFacet;
  text: string;
}

export interface RebuildPlan {
  items: RebuildItem[];
  counts: { entities: number; decisions: number; decision_facets: number; patterns: number; total: number };
  existing: { total: number; sessions_kept: number; dropped: number };
}

export interface RebuildReport {
  dry_run: boolean;
  provider: Pick<ProviderState, "configured" | "ready" | "name" | "model" | "dimensions" | "reason">;
  plan: RebuildPlan["counts"];
  existing: RebuildPlan["existing"];
  written: boolean;
  embedded: number;
  path: string | null;
  message: string;
}

export async function planRebuild(ctx: ToolContext): Promise<RebuildPlan> {
  const items: RebuildItem[] = [];
  let entities = 0;
  let decisions = 0;
  let decisionFacets = 0;
  let patterns = 0;

  const entityList = (await ctx.storage.listEntities()).filter((e) => e && typeof e.id === "string" && isCurrentEntity(e));
  entityList.sort((a, b) => a.id.localeCompare(b.id));
  for (const e of entityList) {
    const text = entityEmbeddingText(e as unknown as Record<string, unknown>);
    if (!text.trim()) continue;
    items.push({ source_kind: "entity", source_id: e.id, text });
    entities += 1;
  }

  const decisionList = (await ctx.storage.getDecisions()).filter((d) => d && typeof d.id === "string" && isCurrentDecision(d));
  decisionList.sort((a, b) => a.id.localeCompare(b.id));
  for (const d of decisionList) {
    const facets = decisionEmbeddingTexts(d as unknown as Record<string, unknown>).filter((f) => f.text.trim());
    if (facets.length === 0) continue;
    decisions += 1;
    for (const { facet, text } of facets) {
      items.push({ source_kind: "decision", source_id: d.id, facet, text });
      decisionFacets += 1;
    }
  }

  const patternList = (await ctx.storage.getPatterns()).filter((p) => p && typeof p.id === "string" && isCurrentPattern(p));
  patternList.sort((a, b) => a.id.localeCompare(b.id));
  for (const p of patternList) {
    const text = patternEmbeddingText(p as unknown as Record<string, unknown>);
    if (!text.trim()) continue;
    items.push({ source_kind: "pattern", source_id: p.id, text });
    patterns += 1;
  }

  const provider = await getProviderState();
  const existing = await loadEmbeddingsIndex();
  // Sessions are not reconstructible from canonical state (they are write-time
  // summaries), so compatible session vectors are carried over; everything
  // else is replaced.
  let sessionsKept = 0;
  if (provider.ready && provider.model && provider.dimensions) {
    const active = { name: provider.name as "openai" | "local", model: provider.model, dimensions: provider.dimensions };
    for (const e of existing) {
      if (e?.source_kind === "session" && classifyEntry(e, active) === "compatible") sessionsKept += 1;
    }
  }

  return {
    items,
    counts: { entities, decisions, decision_facets: decisionFacets, patterns, total: items.length },
    existing: { total: existing.length, sessions_kept: sessionsKept, dropped: existing.length - sessionsKept },
  };
}

export async function rebuildEmbeddingsIndex(
  ctx: ToolContext,
  options: { dryRun: boolean; log?: (line: string) => void },
): Promise<RebuildReport> {
  const log = options.log ?? (() => {});
  const provider = await getProviderState();
  const plan = await planRebuild(ctx);
  const providerSummary = {
    configured: provider.configured,
    ready: provider.ready,
    name: provider.name,
    model: provider.model,
    dimensions: provider.dimensions,
    reason: provider.reason,
  };

  // Always show the plan BEFORE any external call.
  log(
    `Rebuild plan: ${plan.counts.total} vectors ` +
    `(${plan.counts.entities} entities, ${plan.counts.decisions} decisions as ${plan.counts.decision_facets} facets, ${plan.counts.patterns} patterns); ` +
    `existing index: ${plan.existing.total} entries, ${plan.existing.sessions_kept} session vectors kept, ${plan.existing.dropped} replaced/dropped.`,
  );
  log(`Provider: ${provider.ready ? `${provider.name} / ${provider.model} / ${provider.dimensions} dims` : `not ready (${provider.reason ?? "unknown"})`}.`);

  const base = { dry_run: options.dryRun, provider: providerSummary, plan: plan.counts, existing: plan.existing };

  if (options.dryRun) {
    return { ...base, written: false, embedded: 0, path: null, message: "Dry run: no API calls made, no files written." };
  }

  if (!provider.ready || !provider.model || !provider.dimensions) {
    return {
      ...base,
      written: false,
      embedded: 0,
      path: null,
      message: `Provider not ready (${provider.reason ?? "unknown"}): ${provider.message ?? ""}`.trim() + " Nothing written.",
    };
  }

  const active = { name: provider.name as "openai" | "local", model: provider.model, dimensions: provider.dimensions };
  const next: StoredEmbedding[] = [];
  const existing = await loadEmbeddingsIndex();
  for (const e of existing) {
    if (e?.source_kind === "session" && classifyEntry(e, active) === "compatible") next.push(e);
  }

  let embedded = 0;
  for (const item of plan.items) {
    let vector: number[] | null;
    try {
      vector = await embedTextStrict(item.text);
    } catch (e) {
      const sanitized = sanitizeProviderError(e);
      return {
        ...base,
        written: false,
        embedded,
        path: null,
        message: `Aborted after ${embedded} of ${plan.counts.total} vectors: ${sanitized.message} Existing index left untouched.`,
      };
    }
    if (!vector || vector.length !== active.dimensions) {
      return {
        ...base,
        written: false,
        embedded,
        path: null,
        message: `Aborted after ${embedded} of ${plan.counts.total} vectors: provider returned an unusable vector. Existing index left untouched.`,
      };
    }
    next.push(buildStoredEmbedding(item.source_kind, item.source_id, item.text, vector, active, item.facet));
    embedded += 1;
    if (embedded % 50 === 0) log(`  embedded ${embedded}/${plan.counts.total}`);
  }

  const path = await replaceEmbeddingsIndex(next);
  log(`Wrote ${next.length} vectors atomically to ${path}.`);
  return { ...base, written: true, embedded, path, message: `Rebuilt ${embedded} vectors; ${plan.existing.sessions_kept} session vectors kept.` };
}
