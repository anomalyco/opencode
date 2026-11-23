import type { WidthMethod } from "@opentui/core"
import { promptOffsetIndex } from "./display"

export function expandPastedTextPlaceholders(
  text: string,
  pasted: readonly { text: string; source: { text: string; start?: number } }[],
) {
  let cursor = 0
  let result = ""
  for (const part of pasted.toSorted((a, b) => (a.source.start ?? 0) - (b.source.start ?? 0))) {
    const index = text.indexOf(part.source.text, cursor)
    if (index === -1) continue
    result += text.slice(cursor, index) + part.text
    cursor = index + part.source.text.length
  }
  return result + text.slice(cursor)
}

export function expandTrackedPastedText(
  text: string,
  ranges: { start: number; end: number; text: string }[],
  widthMethod: WidthMethod,
) {
  // Ranges expand from right to left, so indices found in the unexpanded text stay valid.
  return ranges
    .slice()
    .sort((a, b) => b.start - a.start)
    .reduce(
      (result, part) =>
        result.slice(0, promptOffsetIndex(text, part.start, widthMethod)) +
        part.text +
        result.slice(promptOffsetIndex(text, part.end, widthMethod)),
      text,
    )
}
