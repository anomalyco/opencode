import type { PromptInfo } from "./history"
import { displayOffsetIndex, stringIndexDisplayOffset } from "@/cli/cmd/prompt-display"

export type PromptPartExtmark = {
  id: number
  start: number
  end: number
}

function virtualTextRange(text: string, extmark: PromptPartExtmark, virtualText: string) {
  const start = displayOffsetIndex(text, extmark.start)
  const end = displayOffsetIndex(text, extmark.end)
  if (text.slice(start, end) === virtualText) return { start, end }

  const ranges = []
  let index = text.indexOf(virtualText)
  while (index !== -1) {
    ranges.push({ start: index, end: index + virtualText.length })
    index = text.indexOf(virtualText, index + virtualText.length)
  }

  return (
    ranges.sort(
      (a, b) =>
        Math.abs(stringIndexDisplayOffset(text, a.start) - extmark.start) -
          Math.abs(stringIndexDisplayOffset(text, b.start) - extmark.start) || b.start - a.start,
    )[0] ?? { start, end }
  )
}

export function expandPromptTextParts(
  input: string,
  extmarks: readonly PromptPartExtmark[],
  extmarkToPartIndex: ReadonlyMap<number, number>,
  parts: PromptInfo["parts"],
) {
  return [...extmarks]
    .sort((a, b) => b.start - a.start)
    .reduce((text, extmark) => {
      const partIndex = extmarkToPartIndex.get(extmark.id)
      const part = partIndex === undefined ? undefined : parts[partIndex]
      if (part?.type !== "text" || !part.text) return text

      const range = part.source?.text.value
        ? virtualTextRange(text, extmark, part.source.text.value)
        : {
            start: displayOffsetIndex(text, extmark.start),
            end: displayOffsetIndex(text, extmark.end),
          }
      return text.slice(0, range.start) + part.text + text.slice(range.end)
    }, input)
}
