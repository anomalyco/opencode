import { frame } from "./frame"

type Span = { index: number; length: number }

type Inline = {
  focusEnd: () => void
  mounted: boolean
  rendering: boolean
  waitForUpdate: () => Promise<void>
  getInlineRange: () => Span | null
  insertText: (range: Span, text: string) => void
  setInlineRange: (range: Span) => void
}

type Rich = HTMLElement & {
  inlineEditor?: Inline | null
  updateComplete?: Promise<unknown>
}

export type EditorEl = HTMLElement & { host?: { querySelector: HTMLElement["querySelector"] } | null }

function rich(editor: EditorEl) {
  const el = editor.host?.querySelector("rich-text") ?? editor.querySelector("rich-text")
  if (!el || !("inlineEditor" in el)) return
  return el as Rich
}

export function softBreak(editor: EditorEl) {
  const active = document.activeElement
  const hit =
    active instanceof HTMLElement && active.closest
      ? active.closest("rich-text")
      : null
  const el = hit && "inlineEditor" in hit ? (hit as Rich) : rich(editor)
  const inline = el?.inlineEditor
  const range = inline?.getInlineRange()
  if (!inline || !range) return false
  inline.insertText(range, "\n")
  inline.setInlineRange({ index: range.index + 1, length: 0 })
  return true
}

export async function inlineReady(editor: EditorEl) {
  while (true) {
    const el = rich(editor)
    await el?.updateComplete
    const next = el?.inlineEditor
    if (next?.mounted && !next.rendering) {
      await next.waitForUpdate()
      if (next.mounted && !next.rendering) return next
    }
    await frame()
  }
}
