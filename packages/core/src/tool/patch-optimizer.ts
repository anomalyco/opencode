export * as PatchOptimizer from "./patch-optimizer"

export interface OccurrenceInfo {
  readonly lineNumber: number
  readonly offset: number
  readonly contextAbove: readonly string[]
  readonly contextBelow: readonly string[]
}

/**
 * Finds all exact occurrences of a search string in file content and extracts
 * surrounding line context to help the model disambiguate at $0 remote tokens.
 */
export function findOccurrencesWithContext(
  content: string,
  search: string,
  contextLines = 2,
): OccurrenceInfo[] {
  if (search === "") return []

  const occurrences: OccurrenceInfo[] = []
  const allLines = content.split("\n")
  let offset = 0

  while ((offset = content.indexOf(search, offset)) !== -1) {
    const beforeText = content.slice(0, offset)
    const lineNumber = beforeText.split("\n").length
    const lineIndex = lineNumber - 1

    const startAbove = Math.max(0, lineIndex - contextLines)
    const contextAbove = allLines.slice(startAbove, lineIndex)

    const searchLineCount = search.split("\n").length
    const endBelow = Math.min(allLines.length, lineIndex + searchLineCount + contextLines)
    const contextBelow = allLines.slice(lineIndex + searchLineCount, endBelow)

    occurrences.push({
      lineNumber,
      offset,
      contextAbove,
      contextBelow,
    })

    offset += search.length
  }

  return occurrences
}

/**
 * Formats a concise error message showing the exact surrounding lines for each
 * match, avoiding the need for the model to re-read the entire file.
 * Returns undefined if no surrounding lines exist (e.g. single-line files).
 */
export function formatDisambiguationPrompt(
  occurrences: readonly OccurrenceInfo[],
  _search: string,
): string | undefined {
  if (occurrences.length === 0) return undefined

  const hasContext = occurrences.some((o) => o.contextAbove.length > 0 || o.contextBelow.length > 0)
  if (!hasContext && occurrences.every((o) => o.lineNumber === occurrences[0]?.lineNumber)) {
    return undefined
  }

  const lines: string[] = [
    `Context for each match to help disambiguate (include 1 unique surrounding line):`,
  ]

  for (let i = 0; i < occurrences.length; i++) {
    const occ = occurrences[i]!
    lines.push(`\nMatch ${i + 1} at line ${occ.lineNumber}:`)
    if (occ.contextAbove.length > 0) {
      lines.push(...occ.contextAbove.map((l) => `  ${l}`))
    }
    lines.push(`  [oldString]`)
    if (occ.contextBelow.length > 0) {
      lines.push(...occ.contextBelow.map((l) => `  ${l}`))
    }
  }

  return lines.join("\n")
}

export interface FuzzyTrimResult {
  readonly matched: boolean
  readonly actualSubstring?: string
}

/**
 * Flexible line-trimmed matching for edits where trailing whitespace or slight
 * newline differences prevent an exact substring match.
 * Returns the exact slice of the source content if a unique trimmed match is found.
 */
export function fuzzyLineTrimMatch(content: string, search: string): FuzzyTrimResult {
  if (!content || !search) return { matched: false }

  const contentLines = content.split("\n")
  const searchLines = search.split("\n")

  const normalizedSearch = searchLines.map((l) => l.trimEnd())
  const normalizedContent = contentLines.map((l) => l.trimEnd())

  const matches: number[] = []
  for (let i = 0; i <= normalizedContent.length - normalizedSearch.length; i++) {
    let match = true
    for (let j = 0; j < normalizedSearch.length; j++) {
      if (normalizedContent[i + j] !== normalizedSearch[j]) {
        match = false
        break
      }
    }
    if (match) {
      matches.push(i)
    }
  }

  // Only proceed if exactly one unique match is found
  if (matches.length !== 1) {
    return { matched: false }
  }

  const startLineIndex = matches[0]!
  const endLineIndex = startLineIndex + searchLines.length - 1

  // Extract the original content substring spanning from startLineIndex to endLineIndex
  const startCharIndex = contentLines.slice(0, startLineIndex).join("\n").length + (startLineIndex > 0 ? 1 : 0)
  const matchedLines = contentLines.slice(startLineIndex, endLineIndex + 1)
  const endCharIndex = startCharIndex + matchedLines.join("\n").length

  const actualSubstring = content.slice(startCharIndex, endCharIndex)
  return {
    matched: true,
    actualSubstring,
  }
}

/**
 * Normalizes trailing spaces on lines while preserving line breaks.
 */
export function cleanTrailingWhitespace(text: string): string {
  return text.replace(/[ \t]+$/gm, "")
}
