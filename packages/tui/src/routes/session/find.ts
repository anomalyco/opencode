import type { SessionMessageInfo } from "@opencode/client"
import type { LineInfo, TextChunk } from "@opentui/core"
import { stringWidth } from "../../util/string-width"
import { resolvePart, type SessionRow } from "./rows"

/** A user prompt or assistant text part, keyed like its transcript anchor. */
export type FindPart = { messageID: string; partID: string; text: string }
export type FindMatch = { messageID: string; partID: string; occurrence: number }
export type FindRange = { start: number; end: number }

/**
 * Searchable text in transcript order: prompts, assistant text and compaction summaries, not reasoning or tool
 * output.
 */
export function findParts(rows: readonly SessionRow[], message: (messageID: string) => SessionMessageInfo | undefined) {
  return rows.flatMap((row): FindPart[] => {
    if (row.type === "message") {
      const item = message(row.messageID)
      if (item?.type === "user") return item.text ? [{ messageID: item.id, partID: "message", text: item.text }] : []
      if (item?.type !== "compaction") return []
      // CompactionMessage renders the trimmed summary, or the error of a compaction that failed but was not cancelled.
      const text = (
        item.status !== "failed" ? item.summary : item.error.type === "aborted" ? "" : item.error.message
      ).trim()
      return text ? [{ messageID: item.id, partID: "message", text }] : []
    }
    if (row.type !== "part") return []
    const item = message(row.ref.messageID)
    if (item?.type !== "assistant") return []
    const part = resolvePart(item, row.ref.partID)
    // TextPart renders the trimmed text.
    return part?.type === "text" ? [{ messageID: item.id, partID: row.ref.partID, text: part.text.trim() }] : []
  })
}

/** Plain, case-insensitive text; surrounding whitespace in the query is ignored. */
export function findPattern(query: string) {
  // Lowercased so queries that differ only in case compare equal by source. A character whose lowercase form is
  // longer (İ becomes i + U+0307) stays as typed: the expansion would never match it, and the i flag folds case.
  const text = Array.from(query.trim(), (char) =>
    char.toLowerCase().length === char.length ? char.toLowerCase() : char,
  ).join("")
  if (!text) return
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu")
}

/** Non-overlapping occurrences, in order. */
export function findRanges(text: string, pattern: RegExp | undefined): FindRange[] {
  if (!pattern) return []
  return [...text.matchAll(pattern)].map((match) => ({ start: match.index, end: match.index + match[0].length }))
}

export function sameFindMatch(a: FindMatch | undefined, b: FindMatch | undefined) {
  return !!a && !!b && a.messageID === b.messageID && a.partID === b.partID && a.occurrence === b.occurrence
}

/**
 * Each part's matches, as many as `shown` says it displays: markdown hides fence info strings, markers and link
 * targets, and joins text the source splits. A part that has not rendered for the pattern counts its source.
 */
export function findMatches(
  parts: readonly FindPart[],
  pattern: RegExp | undefined,
  shown: (part: FindPart) => number | undefined = () => undefined,
) {
  if (!pattern) return []
  return parts.flatMap((part) =>
    Array.from({ length: shown(part) ?? findRanges(part.text, pattern).length }, (_, occurrence) => ({
      messageID: part.messageID,
      partID: part.partID,
      occurrence,
    })),
  )
}

/**
 * Maps ranges in a highlighted block's source onto the text of its chunks, using the source range
 * OpenTUI reports for each chunk. Concealed markup has no chunk, so a range that only covers
 * concealed text is dropped.
 */
export function displayRanges<Range extends FindRange>(
  chunks: readonly TextChunk[],
  sources: readonly FindRange[],
  ranges: readonly Range[],
): Range[] {
  if (sources.length !== chunks.length) return []
  let length = 0
  const starts = chunks.map((chunk) => {
    const start = length
    length += chunk.text.length
    return start
  })
  // A chunk whose text differs in length from its source replaced concealed markup; it maps as a whole.
  const verbatim = (index: number) => chunks[index]!.text.length === sources[index]!.end - sources[index]!.start
  const startOf = (offset: number) => {
    const index = sources.findIndex((source) => source.end > offset)
    if (index === -1) return length
    const source = sources[index]!
    return starts[index]! + (offset > source.start && verbatim(index) ? offset - source.start : 0)
  }
  const endOf = (offset: number) => {
    const index = sources.findLastIndex((source) => source.start < offset)
    if (index === -1) return 0
    const source = sources[index]!
    return (
      starts[index]! + (offset < source.end && verbatim(index) ? offset - source.start : chunks[index]!.text.length)
    )
  }
  return ranges.flatMap((range) => {
    const start = startOf(range.start)
    const end = endOf(range.end)
    return end > start ? [{ ...range, start, end }] : []
  })
}

/** Splits chunks at the ranges, offsets into their joined text, and paints each covered piece. */
export function paintChunks<Chunk extends { text: string }, Range extends FindRange>(
  chunks: readonly Chunk[],
  ranges: readonly Range[],
  paint: (chunk: Chunk, range: Range) => Chunk,
) {
  let offset = 0
  return chunks.flatMap((chunk) => {
    const start = offset
    offset += chunk.text.length
    const covering = ranges.filter((range) => range.start < offset && range.end > start)
    if (covering.length === 0) return [chunk]
    const cuts = [
      start,
      ...covering.flatMap((range) => [Math.max(range.start, start), Math.min(range.end, offset)]),
      offset,
    ]
    // Even pieces sit between ranges, odd pieces inside covering[(index - 1) / 2].
    return cuts.slice(1).flatMap((end, index) => {
      const text = chunk.text.slice(cuts[index]! - start, end - start)
      if (!text) return []
      return [index % 2 ? paint({ ...chunk, text }, covering[(index - 1) / 2]!) : { ...chunk, text }]
    })
  })
}

/** Visual row, from the renderable's top, that shows the text offset after wrapping. */
export function offsetRow(info: LineInfo, text: string, offset: number) {
  const lines = text.slice(0, offset).split("\n")
  const line = lines.length - 1
  const column = stringWidth(lines[line]!)
  const first = info.lineSources.indexOf(line)
  if (first === -1) return 0
  const wraps = info.lineSources.slice(first).findIndex((source, index) => {
    if (index === 0) return false
    return source !== line || info.lineStartCols[first + index]! - info.lineStartCols[first]! > column
  })
  return wraps === -1 ? info.lineSources.length - 1 : first + wraps - 1
}
