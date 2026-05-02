import { semanticRecall, type RecallResult } from "../utils/embeddings.js";

interface SemanticRecallResult {
  query: string;
  results: RecallResult[];
  count: number;
}

export async function recallByMeaning(
  query: string,
  sourceKind?: string,
  maxResults?: number
): Promise<SemanticRecallResult> {
  const results = await semanticRecall(query, {
    k: maxResults ?? 5,
    threshold: 0.3,
    sourceKind,
  });

  return {
    query,
    results,
    count: results.length,
  };
}
