export * as SemanticRRF from "./rrf"

export const RRF_K_DEFAULT = 60

/**
 * Tokenize a code or query string into clean tokens for lexical matching.
 * Handles whitespace, symbols, camelCase, PascalCase, and snake_case.
 */
export function tokenize(text: string): readonly string[] {
  if (!text) return []

  // Replace symbols and punctuation with spaces, but keep underscores and hyphens temporarily
  const clean = text
    .replace(/[^\w\s-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase split
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // PascalCase acronym split
    .replace(/[_-]/g, " ") // snake_case / kebab-case split
    .toLowerCase()

  const tokens = clean
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))

  return tokens
}

const STOPWORDS = new Set([
  "the", "is", "at", "which", "on", "a", "an", "and", "or", "in", "to", "for", "of", "with",
  "this", "that", "it", "from", "as", "by", "are", "was", "be", "were", "been",
])

/**
 * Calculates a lexical matching score between a query and a target text.
 * Combines term overlap (TF) with an exact substring match bonus.
 */
export function lexicalScore(query: string, text: string): number {
  if (!query || !text) return 0

  const queryLower = query.toLowerCase().trim()
  const textLower = text.toLowerCase()

  let score = 0

  // Exact full query substring match bonus
  if (queryLower.length >= 4 && textLower.includes(queryLower)) {
    score += 10.0
  }

  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return score

  const textTokens = tokenize(text)
  if (textTokens.length === 0) return score

  // Count frequencies in text
  const freqMap = new Map<string, number>()
  for (const token of textTokens) {
    freqMap.set(token, (freqMap.get(token) ?? 0) + 1)
  }

  // Calculate term match score with diminishing returns (log-like TF)
  for (const qToken of queryTokens) {
    const count = freqMap.get(qToken)
    if (count !== undefined && count > 0) {
      score += 1 + Math.min(count - 1, 5) * 0.3
    }
  }

  return score
}

export interface FusedItem<T> {
  readonly item: T
  readonly rrfScore: number
  readonly denseRank?: number
  readonly lexicalRank?: number
}

/**
 * Reciprocal Rank Fusion (RRF) algorithm to combine multiple sorted rankings.
 * Score(d) = sum( 1 / (k + rank_m(d)) ) for each model m.
 *
 * @param rankedLists Array of ranked result lists (each sorted descending by score)
 * @param idFn Function to extract unique identifier from each item
 * @param k Smoothing constant (standard default: 60)
 */
export function reciprocalRankFusion<T>(
  rankedLists: ReadonlyArray<ReadonlyArray<{ readonly item: T; readonly score: number }>>,
  idFn: (item: T) => string,
  k: number = RRF_K_DEFAULT,
): Array<FusedItem<T>> {
  if (rankedLists.length === 0) return []

  const itemMap = new Map<string, T>()
  const rrfScoreMap = new Map<string, number>()
  const ranksMap = new Map<string, { denseRank?: number; lexicalRank?: number }>()

  for (let listIdx = 0; listIdx < rankedLists.length; listIdx++) {
    const list = rankedLists[listIdx]!
    let rank = 1
    for (let rankIdx = 0; rankIdx < list.length; rankIdx++) {
      const entry = list[rankIdx]!
      if (entry.score <= 0) continue

      const id = idFn(entry.item)
      itemMap.set(id, entry.item)

      const currentScore = rrfScoreMap.get(id) ?? 0
      const rankContribution = 1.0 / (k + rank)
      rrfScoreMap.set(id, currentScore + rankContribution)

      const ranks = ranksMap.get(id) ?? {}
      if (listIdx === 0) ranks.denseRank = rank
      if (listIdx === 1) ranks.lexicalRank = rank
      ranksMap.set(id, ranks)
      rank++
    }
  }

  const results: Array<FusedItem<T>> = []
  for (const [id, rrfScore] of rrfScoreMap.entries()) {
    const item = itemMap.get(id)!
    const ranks = ranksMap.get(id)!
    results.push({
      item,
      rrfScore,
      denseRank: ranks.denseRank,
      lexicalRank: ranks.lexicalRank,
    })
  }

  // Sort descending by RRF score
  results.sort((a, b) => b.rrfScore - a.rrfScore)
  return results
}

export interface HybridRankInput<T> {
  readonly query: string
  readonly candidates: readonly T[]
  readonly idFn: (item: T) => string
  readonly textFn: (item: T) => string
  readonly denseScoreFn: (item: T) => number
  readonly k?: number
}

/**
 * High-level helper: takes candidates with existing dense similarity scores,
 * computes lexical scores for the query, and combines both with RRF.
 */
export function hybridRank<T>(input: HybridRankInput<T>): Array<FusedItem<T>> {
  if (input.candidates.length === 0) return []

  // 1. Sort by dense score
  const denseList = input.candidates
    .map((item) => ({ item, score: input.denseScoreFn(item) }))
    .sort((a, b) => b.score - a.score)

  // 2. Score and sort by lexical score
  const lexicalList = input.candidates
    .map((item) => ({ item, score: lexicalScore(input.query, input.textFn(item)) }))
    .sort((a, b) => b.score - a.score)

  // 3. Fuse via RRF
  return reciprocalRankFusion([denseList, lexicalList], input.idFn, input.k ?? RRF_K_DEFAULT)
}
