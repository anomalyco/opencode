import type { ClipboardService } from "../context/clipboard"

type Toast = {
  show: (input: { message: string; variant: "info" | "success" | "warning" | "error" }) => void
  error: (err: unknown) => void
}

type FocusableSelectionTarget = {
  hasSelection: () => boolean
  getClipboardText?: (text: string) => string
}

type Renderer = {
  getSelection: () => { getSelectedText: () => string; selectedRenderables: FocusableSelectionTarget[] } | null
  clearSelection: () => void
  currentFocusedRenderable?: FocusableSelectionTarget | null
}

type SelectionKeyEvent = {
  ctrl?: boolean
  name: string
  preventDefault: () => void
  stopPropagation: () => void
}

export function text(renderer: Renderer) {
  const selection = renderer.getSelection()
  if (!selection) return undefined
  const selected = selection.getSelectedText()
  if (!selected) return undefined
  const focus = renderer.currentFocusedRenderable
  if (focus?.getClipboardText && selection.selectedRenderables.includes(focus)) return focus.getClipboardText(selected)
  return selected
}

// Blank lines carry a bare ">" and content lines drop trailing padding, so a quoted block
// never introduces trailing whitespace. Already-quoted lines nest, which is what they mean.
export function quote(value: string) {
  return (
    value
      .split("\n")
      .map((line) => (line.trim() ? `> ${line.trimEnd()}` : ">"))
      .join("\n") + "\n"
  )
}

// `retain` keeps the highlight up after copy-on-select so it can still be acted on, for
// example added to the prompt. The highlight is dismissed by the next click or key press.
export function copy(
  renderer: Renderer,
  toast: Toast,
  clipboard: ClipboardService,
  options?: { retain?: boolean },
): boolean {
  const clipboardText = text(renderer)
  if (!clipboardText) return false

  clipboard
    ?.write?.(clipboardText)
    .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
    .catch(toast.error)

  if (!options?.retain) renderer.clearSelection()
  return true
}

export function handleSelectionKey(
  renderer: Renderer,
  toast: Toast,
  event: SelectionKeyEvent,
  clipboard: ClipboardService,
) {
  const selection = renderer.getSelection()
  if (!selection) return

  if (event.ctrl && event.name === "c") {
    if (!copy(renderer, toast, clipboard)) {
      renderer.clearSelection()
      return
    }

    event.preventDefault()
    event.stopPropagation()
    return
  }

  if (event.name === "escape") {
    renderer.clearSelection()
    event.preventDefault()
    event.stopPropagation()
    return
  }

  const focus = renderer.currentFocusedRenderable
  if (focus?.hasSelection() && selection.selectedRenderables.includes(focus)) return

  renderer.clearSelection()
}

export * as Selection from "./selection"
