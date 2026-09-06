const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function promptOffsetWidth(value: string) {
  let width = 0
  for (const part of graphemes.segment(value)) {
    // Textarea offsets count newlines as one position; Bun.stringWidth counts them as zero.
    width += part.segment === "\n" ? 1 : Bun.stringWidth(part.segment)
  }
  return width
}

function displayOffsetIndex(value: string, offset: number) {
  if (offset <= 0) return 0

  let width = 0
  for (const part of graphemes.segment(value)) {
    const next = width + promptOffsetWidth(part.segment)
    if (next > offset) return part.index
    width = next
  }

  return value.length
}

export function displaySlice(value: string, start = 0, end = promptOffsetWidth(value)) {
  return value.slice(displayOffsetIndex(value, start), displayOffsetIndex(value, end))
}

export function displayCharAt(value: string, offset: number) {
  let width = 0
  for (const part of graphemes.segment(value)) {
    const next = width + promptOffsetWidth(part.segment)
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

// Display-width offset of the "/" that starts the slash-command token ending at
// the cursor, or undefined when the cursor is not inside such a token. The token
// must start the prompt or follow whitespace, so in-word paths like "src/app"
// don't trigger.
export function slashTriggerIndex(value: string, offset = promptOffsetWidth(value)) {
  const text = displaySlice(value, 0, offset)
  const match = text.match(/(?:^|\s)(\/\S*)$/)
  if (!match) return
  return promptOffsetWidth(text.slice(0, text.length - match[1].length))
}

