import { semanticRecall, EmbeddingsNotConfiguredError, type RecallResult } from "../utils/embeddings.js";

interface SemanticRecallResult {
  query: string;
  results: RecallResult[];
  count: number;
  error?: "embeddings_not_configured";
  message?: string;
}

export async function recallByMeaning(
  query: string,
  sourceKind?: string,
  maxResults?: number
): Promise<SemanticRecallResult> {
  try {
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
  } catch (e) {
    if (e instanceof EmbeddingsNotConfiguredError) {
      return {
        query,
        results: [],
        count: 0,
        error: "embeddings_not_configured",
        message: e.message,
      };
    }
    throw e;
  }
}
