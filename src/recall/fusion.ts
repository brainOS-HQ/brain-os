/**
 * Reciprocal-rank fusion (RRF) of ranked lists.
 *
 * score(item) = Σ_lists 1 / (K + rank_in_list), rank 1-based. RRF fuses by
 * POSITION, not raw score, so a lexical score (unbounded, additive) and a
 * cosine similarity (0..1) can be combined without one scale swamping the
 * other. K = 60 is the conventional constant from the original paper.
 *
 * Tie-break is total and deterministic: fused score desc → present in more
 * lists → better best-rank → key asc.
 */

export const RRF_K = 60;

export interface RankedItem<T> {
  key: string;
  item: T;
}

export interface FusedItem<T> {
  key: string;
  score: number;
  /** 1-based rank per list index; undefined when absent from that list. */
  ranks: Array<number | undefined>;
  /** The item from the first list that contained it (lists are in priority order). */
  item: T;
}

export function reciprocalRankFusion<T>(lists: Array<RankedItem<T>[]>, k: number = RRF_K): FusedItem<T>[] {
  const fused = new Map<string, FusedItem<T>>();
  lists.forEach((list, li) => {
    list.forEach((entry, idx) => {
      const rank = idx + 1;
      let f = fused.get(entry.key);
      if (!f) {
        f = { key: entry.key, score: 0, ranks: new Array<number | undefined>(lists.length).fill(undefined), item: entry.item };
        fused.set(entry.key, f);
      }
      // First occurrence per list wins; later duplicates in the same list are ignored.
      if (f.ranks[li] === undefined) {
        f.ranks[li] = rank;
        f.score += 1 / (k + rank);
      }
    });
  });

  const out = Array.from(fused.values());
  for (const f of out) f.score = Math.round(f.score * 1e6) / 1e6;
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aLists = a.ranks.filter((r) => r !== undefined).length;
    const bLists = b.ranks.filter((r) => r !== undefined).length;
    if (bLists !== aLists) return bLists - aLists;
    const aBest = Math.min(...a.ranks.map((r) => r ?? Number.POSITIVE_INFINITY));
    const bBest = Math.min(...b.ranks.map((r) => r ?? Number.POSITIVE_INFINITY));
    if (aBest !== bBest) return aBest - bBest;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return out;
}
