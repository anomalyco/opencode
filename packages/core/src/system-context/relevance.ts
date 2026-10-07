/**
 * Context Engine — Slice 1 / FASE 14 (relevance + compression engine).
 *
 * Pure, dependency-free ranking primitives. Per-turn retrievers and context
 * sources consume these so budgeted, relevance-trimmed context never exceeds a
 * token cap — the "don't send the whole repo" guard. Semantic embedding lookup
 * lives behind these hooks once an embedding provider is wired; until then the
 * engine ranks by query-term overlap, which composes identically.
 */

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "in",
  "on",
  "at",
  "of",
  "and",
  "or",
  "but",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "for",
  "with",
  "by",
  "from",
  "as",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "can",
  "could",
  "should",
  "not",
])

/** Rough 4-chars-per-token heuristic; deterministic and dependency-free. */
export const estimateTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4))

/** Lowercases, splits on non-alphanumerics, and drops stopwords. */
export const tokenizeQuery = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 0 && !STOPWORDS.has(term))

/** Count of distinct query terms present in the document (substring, case-insensitive). */
export const relevanceScore = (query: string, document: string): number => {
  const terms = tokenizeQuery(query)
  if (terms.length === 0) return 0
  const lower = document.toLowerCase()
  return terms.filter((term) => lower.includes(term)).length
}

export interface Scored<T> {
  readonly source: T
  readonly score: number
  readonly rank: number
}

/**
 * Ranks items by query overlap (descending); ties keep original order (stable).
 * `pick` extracts the comparable text from each item.
 */
export const rankByRelevance = <T>(
  query: string,
  items: ReadonlyArray<T>,
  pick: (item: T) => string,
): Scored<T>[] =>
  Array.from(items, (source, rank) => ({ source, score: relevanceScore(query, pick(source)), rank })).toSorted(
    (a, b) => b.score - a.score || a.rank - b.rank,
  )

interface CompressState<T> {
  readonly kept: T[]
  readonly used: number
  readonly stop: boolean
}

/**
 * Keeps a prefix of a relevance-sorted list whose token cost fits `budgetTokens`.
 * Stops at the first over-budget item (relevance lists are prefix-safe): later,
 * lower-scoring items are dropped rather than fragmented in.
 */
export const compressToBudget = <T extends { readonly text: string }>(
  items: ReadonlyArray<T>,
  budgetTokens: number,
  tokenizer: (text: string) => number = estimateTokens,
): T[] =>
  items.reduce<CompressState<T>>(
    (acc, item) =>
      acc.stop || acc.used >= budgetTokens
        ? acc
        : (acc.used + tokenizer(item.text) <= budgetTokens
            ? { kept: [...acc.kept, item], used: acc.used + tokenizer(item.text), stop: false }
            : { ...acc, stop: true }) as CompressState<T>,
    { kept: [], used: 0, stop: false },
  ).kept
