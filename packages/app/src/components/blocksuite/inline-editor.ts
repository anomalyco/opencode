import { frame } from "./frame"

type Inline = {
  focusEnd: () => void
  mounted: boolean
  rendering: boolean
  waitForUpdate: () => Promise<void>
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
