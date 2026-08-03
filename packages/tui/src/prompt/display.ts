import type { EditBufferRenderable } from "@opentui/core"

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function promptOffsetWidth(value: string) {
  let width = 0
  for (const part of graphemes.segment(value)) {
    // Textarea offsets count newlines as one position and tabs as two, while
    // Bun.stringWidth counts both as zero.
    if (part.segment === "\n") {
      width += 1
      continue
    }
    if (part.segment === "\t") {
      width += 2
      continue
    }

    // The widget measures a cluster by the width of the character it renders,
    // so decomposed input (IME-committed hangul jamo, か + combining dakuten)
    // has to be composed first or each piece gets counted on its own. Only
    // multi-codepoint clusters can decompose, so single ones skip the work.
    width += Bun.stringWidth(part.segment.length > 1 ? part.segment.normalize("NFC") : part.segment)
  }
  return width
}

// visualCursor.visualRow is viewport-relative, so scrollY is what makes it a
// document row. Comparing visualRow alone treats the top of a scrolled viewport
// as the first line of the buffer.
export function promptOnFirstRow(input: EditBufferRenderable) {
  return input.scrollY + input.visualCursor.visualRow === 0
}

export function promptOnLastRow(input: EditBufferRenderable) {
  return input.scrollY + input.visualCursor.visualRow === Math.max(0, input.editorView.getTotalVirtualLineCount() - 1)
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
