import type { WidthMethod } from "@opentui/core"
import { promptOffsetIndex } from "./display"

export function expandPastedTextPlaceholders(
  text: string,
  pasted: readonly { text: string; source: { text: string } }[],
) {
  return pasted.reduce((result, part) => result.replace(part.source.text, part.text), text)
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
