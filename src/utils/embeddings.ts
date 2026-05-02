import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { getBrainDir } from "./file-store.js";

interface StoredEmbedding {
  id: string;
  source_kind: "entity" | "decision" | "pattern" | "session";
  source_id: string;
  content: string;
  vector: number[];
  provider: "local" | "openai";
  created_at: string;
}

export interface RecallResult {
  source_kind: string;
  source_id: string;
  content: string;
  similarity: number;
}

// --- Provider abstraction ---

type EmbedFn = (text: string) => Promise<number[] | null>;

let activeProvider: { name: "local" | "openai"; embed: EmbedFn } | null = null;
let initPromise: Promise<void> | null = null;

async function initProvider(): Promise<void> {
  // Try OpenAI first (higher quality, optional)
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: openaiKey });
      activeProvider = {
        name: "openai",
        embed: async (text: string) => {
          const res = await client.embeddings.create({
            model: "text-embedding-3-small",
            input: text.slice(0, 30000),
            dimensions: 384,
          });
          return res.data[0].embedding;
        },
      };
      return;
    } catch {
      // Fall through to local
    }
  }

  // Local embeddings (product default — no API key needed)
  try {
    const { pipeline } = await import("@huggingface/transformers");
    const extractor = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
      { dtype: "fp32" }
    );
    activeProvider = {
      name: "local",
      embed: async (text: string) => {
        const output = await extractor(text.slice(0, 8000), {
          pooling: "mean",
          normalize: true,
        });
        return Array.from(output.data as Float32Array);
      },
    };
  } catch {
    activeProvider = null;
  }
}

async function getProvider() {
  if (!initPromise) initPromise = initProvider();
  await initPromise;
  return activeProvider;
}

// --- Storage ---

function getEmbeddingsPath(): string {
  return join(getBrainDir(), "embeddings.json");
}

async function loadEmbeddings(): Promise<StoredEmbedding[]> {
  const path = getEmbeddingsPath();
  if (!existsSync(path)) return [];
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as StoredEmbedding[];
  } catch {
    return [];
  }
}

async function saveEmbeddings(embeddings: StoredEmbedding[]): Promise<void> {
  const dir = getBrainDir();
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(getEmbeddingsPath(), JSON.stringify(embeddings), "utf-8");
}

// --- Core functions ---

export async function embedText(text: string): Promise<number[] | null> {
  const provider = await getProvider();
  if (!provider) return null;
  try {
    return await provider.embed(text);
  } catch {
    return null;
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export async function embedAndStore(
  sourceKind: StoredEmbedding["source_kind"],
  sourceId: string,
  content: string
): Promise<void> {
  const provider = await getProvider();
  if (!provider) return;

  const vector = await provider.embed(content.slice(0, 8000));
  if (!vector) return;

  const all = await loadEmbeddings();

  // If provider changed, re-embed everything (vectors are incompatible across providers)
  const existing = all.findIndex(
    (e) => e.source_kind === sourceKind && e.source_id === sourceId
  );

  const entry: StoredEmbedding = {
    id: `${sourceKind}-${sourceId}`,
    source_kind: sourceKind,
    source_id: sourceId,
    content: content.slice(0, 2000),
    vector,
    provider: provider.name,
    created_at: new Date().toISOString(),
  };

  if (existing >= 0) {
    all[existing] = entry;
  } else {
    all.push(entry);
  }

  await saveEmbeddings(all);
}

export async function semanticRecall(
  query: string,
  options?: {
    k?: number;
    threshold?: number;
    sourceKind?: string;
  }
): Promise<RecallResult[]> {
  const k = options?.k ?? 5;
  const threshold = options?.threshold ?? 0.3;
  const provider = await getProvider();
  if (!provider) return [];

  const queryVec = await provider.embed(query);
  if (!queryVec) return [];

  const all = await loadEmbeddings();
  if (all.length === 0) return [];

  // Only compare against embeddings from the same provider
  const compatible = all.filter((e) => e.provider === provider.name);

  const scored = compatible
    .filter((e) => !options?.sourceKind || e.source_kind === options.sourceKind)
    .map((e) => ({
      source_kind: e.source_kind,
      source_id: e.source_id,
      content: e.content,
      similarity: cosine(queryVec, e.vector),
    }))
    .filter((e) => e.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);

  return scored;
}

export async function getProviderInfo(): Promise<{ provider: string; ready: boolean }> {
  const provider = await getProvider();
  return {
    provider: provider?.name ?? "none",
    ready: provider !== null,
  };
}

// --- Convenience: embed structured data ---

export async function embedEntity(entityId: string, entity: Record<string, unknown>): Promise<void> {
  const parts = [
    entity.name,
    entity.status,
    entity.next_move,
    entity.last_decision,
    entity.evidence_of_progress,
    ...(Array.isArray(entity.open_questions) ? entity.open_questions : []),
  ].filter(Boolean);
  await embedAndStore("entity", entityId, parts.join(" | "));
}

export async function embedDecision(decisionId: string, decision: Record<string, unknown>): Promise<void> {
  const parts = [
    decision.decision,
    decision.why,
    decision.chosen_direction,
    decision.proof_action,
  ].filter(Boolean);
  await embedAndStore("decision", decisionId, parts.join(" | "));
}

export async function embedSession(sessionId: string, summary: string): Promise<void> {
  await embedAndStore("session", sessionId, summary);
}
