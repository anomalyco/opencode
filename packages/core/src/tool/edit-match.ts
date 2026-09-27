/**
 * Pure text-matching strategies behind the V2 edit leaf. Exact matching is the
 * fast path; the lenient strategies are only consulted once exact matching
 * returns zero, each is bounded so a candidate can only span the region
 * oldString describes, and an ambiguous candidate is never guessed at.
 */
export * as EditMatch from "./edit-match"

export type Strategy =
  | "exact"
  | "line-trimmed"
  | "block-anchor"
  | "whitespace-normalized"
  | "indentation-flexible"
  | "escape-normalized"
  | "trimmed-boundary"
  | "context-aware"

export type Resolution =
  | { readonly _tag: "Matched"; readonly search: string; readonly count: number; readonly strategy: Strategy }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "Ambiguous"; readonly strategy: Strategy }
  | { readonly _tag: "Disproportionate"; readonly search: string }

const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.65
const MULTIPLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.65
const CONTEXT_AWARE_MIN_LINE_MATCH = 0.5

const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "'": "'",
  '"': '"',
  "`": "`",
  "\\": "\\",
  "\n": "\n",
  $: "$",
}

const countOccurrences = (content: string, search: string) => {
  if (search === "") return content.length + 1
  let count = 0
  let offset = 0
  while ((offset = content.indexOf(search, offset)) !== -1) {
    count++
    offset += search.length
  }
  return count
}

const levenshtein = (a: string, b: string) => {
  if (a === "" || b === "") return Math.max(a.length, b.length)
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
    }
  }
  return matrix[a.length][b.length]
}

/** Windows of `count` lines starting at each `start`, skipping windows that overrun the content. */
const windows = (content: string, count: number) => {
  const lines = content.split("\n")
  return lines
    .map((_, start) => ({ start, count }))
    .filter(({ start }) => start + count <= lines.length)
    .map(({ start, count: size }) => ({ start, lines: lines.slice(start, start + size) }))
}

const dropTrailingBlank = (lines: string[]) => (lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines)

const lineTrimmed = (content: string, find: string) => {
  const searchLines = dropTrailingBlank(find.split("\n"))
  if (searchLines.length === 0) return []
  return windows(content, searchLines.length)
    .filter(({ lines }) => searchLines.every((line, offset) => lines[offset].trim() === line.trim()))
    .map(({ lines }) => lines.join("\n"))
}

const blockAnchor = (content: string, find: string) => {
  const contentLines = content.split("\n")
  const searchLines = dropTrailingBlank(find.split("\n"))
  if (searchLines.length < 3) return []
  const first = searchLines[0].trim()
  const last = searchLines[searchLines.length - 1].trim()
  const maxLineDelta = Math.max(1, Math.floor(searchLines.length * 0.25))

  const similarity = (start: number, end: number) => {
    const comparable = Math.min(searchLines.length - 2, end - start - 1)
    if (comparable <= 0) return 1
    return (
      searchLines
        .slice(1, -1)
        .map((line, offset) => {
          const original = contentLines[start + 1 + offset]?.trim() ?? ""
          const max = Math.max(original.length, line.trim().length)
          // Two blank lines are an exact match, so they must score full marks
          // rather than being skipped and diluting the average (#45199).
          if (max === 0) return 1
          return 1 - levenshtein(original, line.trim()) / max
        })
        .slice(0, comparable)
        .reduce((total, value) => total + value, 0) / comparable
    )
  }

  const anchored = contentLines
    .map((line, start) => {
      if (line.trim() !== first) return undefined
      const end = contentLines.findIndex((candidate, index) => index >= start + 2 && candidate.trim() === last)
      if (end === -1) return undefined
      if (Math.abs(end - start + 1 - searchLines.length) > maxLineDelta) return undefined
      return { start, end }
    })
    .filter((candidate): candidate is { start: number; end: number } => candidate !== undefined)

  if (anchored.length === 0) return []
  const [best] =
    anchored.length === 1
      ? anchored
      : [anchored.reduce((a, b) => (similarity(b.start, b.end) > similarity(a.start, a.end) ? b : a))]
  const threshold =
    anchored.length === 1 ? SINGLE_CANDIDATE_SIMILARITY_THRESHOLD : MULTIPLE_CANDIDATE_SIMILARITY_THRESHOLD
  if (similarity(best.start, best.end) < threshold) return []
  return [contentLines.slice(best.start, best.end + 1).join("\n")]
}

const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim()

const whitespaceNormalized = (content: string, find: string) => {
  const normalizedFind = normalizeWhitespace(find)
  const single = content.split("\n").flatMap((line) => {
    const normalized = normalizeWhitespace(line)
    if (normalized === normalizedFind) return [line]
    if (!normalized.includes(normalizedFind)) return []
    // Every literal is escaped, so the assembled pattern is always a valid regex.
    const pattern = find
      .trim()
      .split(/\s+/)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+")
    return [line.match(new RegExp(pattern))?.[0]].filter((match): match is string => match !== undefined)
  })
  const findLines = find.split("\n")
  if (findLines.length <= 1) return single
  const blocks = windows(content, findLines.length)
    .map(({ lines }) => lines.join("\n"))
    .filter((block) => normalizeWhitespace(block) === normalizedFind)
  return [...single, ...blocks]
}

const removeIndentation = (text: string) => {
  const lines = text.split("\n")
  const indents = lines.filter((line) => line.trim().length > 0).map((line) => line.match(/^(\s*)/)?.[1].length ?? 0)
  if (indents.length === 0) return text
  const min = Math.min(...indents)
  return lines.map((line) => (line.trim().length === 0 ? line : line.slice(min))).join("\n")
}

const indentationFlexible = (content: string, find: string) => {
  const normalizedFind = removeIndentation(find)
  return windows(content, find.split("\n").length)
    .map(({ lines }) => lines.join("\n"))
    .filter((block) => removeIndentation(block) === normalizedFind)
}

const unescape = (text: string) =>
  text.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (match, captured: string) => ESCAPES[captured] ?? match)

const escapeNormalized = (content: string, find: string) => {
  const unescapedFind = unescape(find)
  const direct = content.includes(unescapedFind) ? [unescapedFind] : []
  const blocks = windows(content, unescapedFind.split("\n").length)
    .map(({ lines }) => lines.join("\n"))
    .filter((block) => unescape(block) === unescapedFind)
  return [...direct, ...blocks]
}

const trimmedBoundary = (content: string, find: string) => {
  const trimmedFind = find.trim()
  if (trimmedFind === find) return []
  const direct = content.includes(trimmedFind) ? [trimmedFind] : []
  const blocks = windows(content, find.split("\n").length)
    .map(({ lines }) => lines.join("\n"))
    .filter((block) => block.trim() === trimmedFind)
  return [...direct, ...blocks]
}

const contextAware = (content: string, find: string) => {
  const findLines = dropTrailingBlank(find.split("\n"))
  if (findLines.length < 3) return []
  const contentLines = content.split("\n")
  const first = findLines[0].trim()
  const last = findLines[findLines.length - 1].trim()
  return contentLines.flatMap((line, start) => {
    if (line.trim() !== first) return []
    const end = contentLines.findIndex((candidate, index) => index >= start + 2 && candidate.trim() === last)
    if (end === -1) return []
    const blockLines = contentLines.slice(start, end + 1)
    if (blockLines.length !== findLines.length) return []
    const middles = findLines
      .slice(1, -1)
      .map((findLine, offset) => ({ block: blockLines[offset + 1].trim(), find: findLine.trim() }))
      .filter(({ block, find: wanted }) => block.length > 0 || wanted.length > 0)
    const matched = middles.filter(({ block, find: wanted }) => block === wanted).length
    if (middles.length > 0 && matched / middles.length < CONTEXT_AWARE_MIN_LINE_MATCH) return []
    return [blockLines.join("\n")]
  })
}

const strategies = [
  ["line-trimmed", lineTrimmed],
  ["block-anchor", blockAnchor],
  ["whitespace-normalized", whitespaceNormalized],
  ["indentation-flexible", indentationFlexible],
  ["escape-normalized", escapeNormalized],
  ["trimmed-boundary", trimmedBoundary],
  ["context-aware", contextAware],
] as const satisfies ReadonlyArray<readonly [Strategy, (content: string, find: string) => string[]]>

/**
 * Carried over from the V1 replacer set as defense in depth. The strategies
 * above are structurally bounded well below both thresholds, so this is not
 * expected to fire for the current set; it is kept so a future, less bounded
 * strategy cannot claim a span far larger than `oldString`.
 */
const isDisproportionate = (search: string, oldString: string) => {
  const oldLines = oldString.split("\n").length
  const searchLines = search.split("\n").length
  if (searchLines >= Math.max(oldLines + 3, oldLines * 2)) return true
  if (oldLines === 1) return false
  return search.trim().length > Math.max(oldString.trim().length + 500, oldString.trim().length * 4)
}

export const resolve = (content: string, oldString: string, replaceAll: boolean): Resolution => {
  const exact = countOccurrences(content, oldString)
  if (exact === 1) return { _tag: "Matched", search: oldString, count: 1, strategy: "exact" }
  if (exact > 1) {
    if (!replaceAll) return { _tag: "Ambiguous", strategy: "exact" }
    return { _tag: "Matched", search: oldString, count: exact, strategy: "exact" }
  }

  for (const [strategy, produce] of strategies) {
    // Dedupe by span rather than matched bytes: two candidates that normalize
    // to the same request but sit at different offsets are two possible edits,
    // and committing the first byte-unique one would bypass the ambiguity
    // safeguard (#41872).
    const spans = [
      ...new Map(
        produce(content, oldString)
          .filter((search) => content.includes(search))
          .map((search) => [content.indexOf(search), search] as const),
      ).entries(),
    ]
    if (spans.length === 0) continue
    if (spans.length > 1 && !replaceAll) return { _tag: "Ambiguous", strategy }
    const search = spans[0][1]
    if (isDisproportionate(search, oldString)) return { _tag: "Disproportionate", search }
    const count = countOccurrences(content, search)
    if (count > 1 && !replaceAll) return { _tag: "Ambiguous", strategy }
    return { _tag: "Matched", search, count, strategy }
  }
  return { _tag: "NotFound" }
}
