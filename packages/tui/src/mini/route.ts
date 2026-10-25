// Deterministic agent routing for `bolt run --auto-agent`: score the prompt
// against per-agent keyword signatures derived from the agents' own names and
// descriptions, pick the best match above a confidence threshold, and fall
// back to the default agent below it. No LLM call is involved.

export interface Candidate {
  name: string
  description?: string
}

export interface Choice {
  agent: string
  score: number
  matched: string[]
}

export const THRESHOLD = 2

const NAME_WEIGHT = 3

// Generic words that appear in prompts and agent descriptions without
// carrying routing intent.
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "into",
  "from",
  "when",
  "use",
  "using",
  "you",
  "your",
  "need",
  "needs",
  "please",
  "can",
  "could",
  "should",
  "would",
  "make",
  "makes",
  "based",
  "each",
  "all",
  "any",
  "are",
  "not",
  "one",
  "our",
  "out",
  "how",
  "what",
  "why",
  "agent",
  "mode",
  "tools",
  "changes",
  "file",
  "files",
])

/** Light plural normalization so "tests" matches "test" and "vulnerabilities" matches "vulnerability". */
export function stem(word: string) {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y"
  if (word.length > 4 && /(?:sh|ch|x|z)es$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1)
  return word
}

/** Lowercased, stemmed word tokens of length 3+, stopwords removed. */
export function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)
    .filter((word) => !STOPWORDS.has(word))
    .map(stem)
}

/** Tokens that appear in several candidates (more than half, and at least two) carry no routing signal. */
export function shared(candidates: Candidate[]) {
  const counts = new Map<string, number>()
  for (const candidate of candidates) {
    const tokens = new Set([...tokenize(candidate.name), ...tokenize(candidate.description ?? "")])
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return new Set(
    [...counts.entries()].filter((entry) => entry[1] >= 2 && entry[1] * 2 > candidates.length).map((entry) => entry[0]),
  )
}

/** Score one candidate against the prompt tokens. Name hits weigh more than description hits. */
export function score(tokens: Set<string>, candidate: Candidate, generic: Set<string>): Choice {
  const names = new Set(tokenize(candidate.name).filter((token) => !generic.has(token)))
  const words = new Set(tokenize(candidate.description ?? "").filter((token) => !generic.has(token)))
  const nameHits = [...names].filter((token) => tokens.has(token))
  const wordHits = [...words].filter((token) => tokens.has(token) && !names.has(token))
  return {
    agent: candidate.name,
    score: nameHits.length * NAME_WEIGHT + wordHits.length,
    matched: [...nameHits, ...wordHits],
  }
}

/**
 * Pick the best-matching agent for a prompt, or undefined to fall back to the
 * default agent. Falls back when no candidate clears the threshold or when the
 * top two candidates tie (an ambiguous prompt).
 */
export function route(prompt: string, candidates: Candidate[], threshold = THRESHOLD): Choice | undefined {
  if (candidates.length === 0) return undefined
  const tokens = new Set(tokenize(prompt))
  const generic = shared(candidates)
  const ranked = candidates
    .map((candidate) => score(tokens, candidate, generic))
    .sort((a, b) => b.score - a.score || a.agent.localeCompare(b.agent))
  const best = ranked[0]
  if (best.score < threshold) return undefined
  if (ranked.length > 1 && ranked[1].score === best.score) return undefined
  return best
}

/** One quiet line explaining the routing decision. */
export function explain(choice: Choice | undefined, fallback: string) {
  if (!choice) return `auto-agent: ${fallback} (default, no confident match)`
  return `auto-agent: ${choice.agent} (matched: ${choice.matched.join(", ")})`
}
