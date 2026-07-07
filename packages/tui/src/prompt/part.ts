import { displaySlice } from "./display"

export function expandPastedTextPlaceholders(
  text: string,
  pasted: readonly { text: string; source: { text: string } }[],
) {
  return pasted.reduce((result, part) => result.replace(part.source.text, part.text), text)
}

export function expandTrackedPastedText(text: string, ranges: { start: number; end: number; text: string }[]) {
  return ranges
    .slice()
    .sort((a, b) => b.start - a.start)
    .reduce((result, part) => displaySlice(result, 0, part.start) + part.text + displaySlice(result, part.end), text)
}
