// Lexical-semantic ranking for the semantic_search tool. This is not an
// embedding index: identifiers are split on camelCase/snake_case boundaries,
// lightly stemmed, weighted by whether they appear on a definition line, and
// chunks are scored with BM25. An embedding backend can replace `rank` later
// without changing the tool surface.

export type Chunk = { file: string; start: number; end: number; text: string }
export type Hit = { chunk: Chunk; score: number }

const CHUNK_SIZE = 40
const CHUNK_STRIDE = 30
const DEFINITION_WEIGHT = 3
const K1 = 1.2
const B = 0.75

// Language keywords and glue words that carry no search meaning.
const STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "and",
  "or",
  "not",
  "is",
  "are",
  "be",
  "it",
  "as",
  "at",
  "by",
  "with",
  "const",
  "let",
  "var",
  "function",
  "return",
  "import",
  "export",
  "from",
  "class",
  "new",
  "this",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "break",
  "continue",
  "type",
  "interface",
  "extends",
  "implements",
  "async",
  "await",
  "yield",
  "public",
  "private",
  "protected",
  "static",
  "void",
  "null",
  "undefined",
  "true",
  "false",
  "string",
  "number",
  "boolean",
  "self",
  "def",
  "fn",
  "func",
  "pub",
  "end",
])

const WORD = /[A-Za-z][A-Za-z0-9]*/g

const DEFINITION =
  /^\s*(?:export\s+)?(?:default\s+)?(?:public\s+|private\s+|protected\s+|static\s+|abstract\s+|async\s+)*(?:function|class|interface|enum|struct|trait|impl|def|fn|func|type|module|namespace)\b/

// Split an identifier on camelCase and acronym boundaries: "parseHTTPRequest"
// becomes ["parse", "http", "request"]. Underscores and other separators are
// already gone because tokens are matched with WORD.
export function split(word: string) {
  return word
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(" ")
    .map((part) => part.toLowerCase())
    .filter((part) => part.length > 1)
}

// Light suffix stemmer so "caches", "cached", and "caching" collapse toward
// one term. Deliberately conservative: identifiers are short and aggressive
// stemming causes false merges.
export function stem(token: string) {
  if (token.length <= 3) return token
  if (token.endsWith("ies") && token.length > 4) return token.slice(0, -3) + "y"
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3)
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2)
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2)
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1)
  return token
}

export function tokenize(text: string) {
  const words = text.match(WORD) ?? []
  return words
    .flatMap((word) => split(word))
    .map((token) => stem(token))
    .filter((token) => !STOP.has(token))
}

// Weighted term frequencies for a chunk. Tokens on definition lines count
// more, so a chunk that defines `parseConfig` outranks chunks that only call
// it.
export function weights(text: string) {
  const result = new Map<string, number>()
  for (const line of text.split("\n")) {
    const weight = DEFINITION.test(line) ? DEFINITION_WEIGHT : 1
    for (const token of tokenize(line)) {
      result.set(token, (result.get(token) ?? 0) + weight)
    }
  }
  return result
}

// Overlapping fixed-size line windows. Overlap keeps definitions that
// straddle a boundary visible in at least one chunk.
export function chunk(file: string, content: string) {
  const lines = content.split("\n")
  const result: Chunk[] = []
  for (let start = 0; start < lines.length; start += CHUNK_STRIDE) {
    const slice = lines.slice(start, start + CHUNK_SIZE)
    if (slice.every((line) => line.trim() === "")) continue
    result.push({
      file,
      start: start + 1,
      end: start + slice.length,
      text: slice.join("\n"),
    })
    if (start + CHUNK_SIZE >= lines.length) break
  }
  return result
}

// BM25 over chunks. Query terms go through the same tokenizer as documents,
// so "parseConfig" matches snake_case `parse_config` definitions.
export function rank(query: string, chunks: Chunk[], limit = 10): Hit[] {
  const terms = [...new Set(tokenize(query))]
  if (terms.length === 0) return []
  const docs = chunks.map((item) => {
    const scored = weights(item.text)
    const length = [...scored.values()].reduce((sum, value) => sum + value, 0)
    return { chunk: item, weights: scored, length }
  })
  if (docs.length === 0) return []
  const average = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length || 1
  const idf = new Map(
    terms.map((term) => {
      const frequency = docs.filter((doc) => doc.weights.has(term)).length
      return [term, Math.log(1 + (docs.length - frequency + 0.5) / (frequency + 0.5))]
    }),
  )
  return docs
    .map((doc) => ({
      chunk: doc.chunk,
      score: terms.reduce((sum, term) => {
        const frequency = doc.weights.get(term) ?? 0
        if (frequency === 0) return sum
        const normalized = (frequency * (K1 + 1)) / (frequency + K1 * (1 - B + B * (doc.length / average)))
        return sum + (idf.get(term) ?? 0) * normalized
      }, 0),
    }))
    .filter((hit) => hit.score > 0)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit)
}

// Human-readable excerpt of a chunk, anchored just above the first line that
// matches a query term. Lines are prefixed with their 1-based file line
// number.
export function snippet(hit: Chunk, terms: string[], limit = 8) {
  const lines = hit.text.split("\n")
  const wanted = new Set(terms)
  const first = lines.findIndex((line) => tokenize(line).some((token) => wanted.has(token)))
  const begin = first === -1 ? 0 : Math.max(0, first - 1)
  return lines
    .slice(begin, begin + limit)
    .map((line, index) => `${hit.start + begin + index}: ${line}`)
    .join("\n")
}

export * as SemanticRank from "./semantic-rank"
