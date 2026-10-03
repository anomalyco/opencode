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
  // This runs on every keystroke while typing. The display-aware scan below
  // walks the entire buffer with Intl.Segmenter (O(n) per keystroke, up to
  // tens of ms for large inputs), so two cheap raw searches gate it first.
  //
  // A trigger can only exist if the text contains an "@".
  if (!value.includes("@")) return

  // With the cursor at the end of an ASCII buffer, a valid trigger must live in
  // the trailing whitespace-delimited word (possibly empty when the buffer ends
  // in whitespace). Resolve it with a raw scan instead of the full-buffer
  // segmenter walk. For non-ASCII text (where display offsets diverge from char
  // offsets) fall through to the exact computation.
  if (offset === value.length && /^[\x00-\x7F]*$/.test(value)) {
    let i = value.length
    while (i > 0 && !/\s/.test(value[i - 1])) i--
    if (!value.slice(i).includes("@")) return
  }

  const text = displaySlice(value, 0, offset)
  const index = text.lastIndexOf("@")
  if (index === -1) return

  const before = index === 0 ? undefined : text[index - 1]
  const query = text.slice(index)
  if ((before === undefined || /\s/.test(before)) && !/\s/.test(query)) {
    return promptOffsetWidth(text.slice(0, index))
  }
}
