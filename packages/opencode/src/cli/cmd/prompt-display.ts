import stringWidth from "string-width"

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

function promptSegmentWidth(value: string) {
  // Textarea offsets count newlines as one position; string-width counts them as zero.
  if (value === "\n") return 1
  return stringWidth(value)
}

export function promptOffsetWidth(value: string) {
  let width = 0
  for (const part of graphemes.segment(value)) {
    width += promptSegmentWidth(part.segment)
  }
  return width
}

export function displayOffsetIndex(value: string, offset: number) {
  if (offset <= 0) return 0

  let width = 0
  for (const part of graphemes.segment(value)) {
    const next = width + promptSegmentWidth(part.segment)
    if (next > offset) return part.index
    if (next === offset) return part.index + part.segment.length
    width = next
  }

  return value.length
}

export function stringIndexDisplayOffset(value: string, index: number) {
  let width = 0
  for (const part of graphemes.segment(value)) {
    if (part.index >= index) return width
    width += promptSegmentWidth(part.segment)
  }
  return width
}

export function displaySlice(value: string, start = 0, end = promptOffsetWidth(value)) {
  return value.slice(displayOffsetIndex(value, start), displayOffsetIndex(value, end))
}

export function displayCharAt(value: string, offset: number) {
  let width = 0
  for (const part of graphemes.segment(value)) {
    const next = width + promptSegmentWidth(part.segment)
    if (offset === width || offset < next) return part.segment
    width = next
  }
}

export function mentionTriggerIndex(value: string, offset = promptOffsetWidth(value)) {
  const text = displaySlice(value, 0, offset)
  const index = text.lastIndexOf("@")
  if (index === -1) return

  const before = index === 0 ? undefined : text[index - 1]
  const query = text.slice(index)
  if ((before === undefined || /\s/.test(before)) && !/\s/.test(query)) {
    return promptOffsetWidth(text.slice(0, index))
  }
}
