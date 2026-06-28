import { queryTokens, tokenize } from "./tokenize"

export interface Doc {
  path: string
  body: string
}

export interface ScoredDoc {
  path: string
  score: number
  snippet: string
}

// Standard BM25 tuning constants.
const K1 = 1.2
const B = 0.75

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Build a truncated snippet around the first matching query term, wrapping
 * matches in `<<...>>` (mirrors MiMo's FTS5 snippet()).
 */
function snippet(body: string, terms: string[]): string {
  const lower = body.toLowerCase()
  let pos = -1
  for (const term of terms) {
    const re = new RegExp(`\\b${escapeRegex(term)}\\b`, "i")
    const m = lower.match(re)
    if (m && m.index !== undefined && (pos === -1 || m.index < pos)) pos = m.index
  }
  if (pos === -1) pos = 0

  const radius = 120
  const start = Math.max(0, pos - radius)
  const end = Math.min(body.length, pos + radius)
  let frag = body.slice(start, end).replace(/\s+/g, " ").trim()
  for (const term of terms) {
    frag = frag.replace(new RegExp(`\\b(${escapeRegex(term)})\\b`, "gi"), "<<$1>>")
  }
  const prefix = start > 0 ? "..." : ""
  const suffix = end < body.length ? "..." : ""
  return `${prefix}${frag}${suffix}`
}

/**
 * BM25 ranking over an in-memory corpus, replacing MiMo's SQLite FTS5 index.
 * Query terms are OR-joined (a doc matches if it contains ANY term) and ranked
 * by BM25. A relative score floor drops common-word-only noise: the top hit is
 * always kept, trailing hits scoring below `floorRatio` of the top are dropped.
 */
export function search(
  docs: Doc[],
  query: string,
  opts?: { limit?: number; floorRatio?: number },
): ScoredDoc[] {
  const limit = opts?.limit ?? 10
  const floorRatio = opts?.floorRatio ?? 0.15
  const terms = queryTokens(query)
  if (terms.length === 0 || docs.length === 0) return []

  const tokenized = docs.map((doc) => {
    const tokens = tokenize(doc.body)
    const tf = new Map<string, number>()
    for (const tok of tokens) tf.set(tok, (tf.get(tok) ?? 0) + 1)
    return { doc, len: tokens.length, tf }
  })

  const N = tokenized.length
  const avgdl = tokenized.reduce((sum, t) => sum + t.len, 0) / N || 1

  const df = new Map<string, number>()
  for (const term of terms) {
    let count = 0
    for (const t of tokenized) if (t.tf.has(term)) count++
    df.set(term, count)
  }
  const idf = (term: string) => {
    const n = df.get(term) ?? 0
    return Math.log(1 + (N - n + 0.5) / (n + 0.5))
  }

  const scored = tokenized
    .map(({ doc, len, tf }) => {
      let score = 0
      let matched = false
      for (const term of terms) {
        const f = tf.get(term) ?? 0
        if (f === 0) continue
        matched = true
        const denom = f + K1 * (1 - B + B * (len / avgdl))
        score += idf(term) * ((f * (K1 + 1)) / denom)
      }
      return { doc, score, matched }
    })
    .filter((s) => s.matched)

  if (scored.length === 0) return []
  scored.sort((a, b) => b.score - a.score)

  const top = scored[0].score
  const cutoff = floorRatio > 0 ? top * floorRatio : -Infinity
  return scored
    .filter((s, i) => i === 0 || s.score >= cutoff)
    .slice(0, limit)
    .map((s) => ({ path: s.doc.path, score: s.score, snippet: snippet(s.doc.body, terms) }))
}
