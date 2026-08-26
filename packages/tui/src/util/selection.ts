import type { SelectionBehavior } from "@opentui/core"
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
  getSelection: () => {
    getSelectedText: () => string
    selectedRenderables: FocusableSelectionTarget[]
    isStart: boolean
    behavior: SelectionBehavior
  } | null
  clearSelection: () => void
  currentFocusedRenderable?: FocusableSelectionTarget | null
}

type SelectionKeyEvent = {
  ctrl?: boolean
  name: string
  preventDefault: () => void
  stopPropagation: () => void
}

export function copyOnSelectRelease(
  event: { isDragging?: boolean },
  renderer: Renderer,
  toast: Toast,
  clipboard: ClipboardService,
): boolean {
  if (!event.isDragging) return false
  const selection = renderer.getSelection()
  // Preserve the first click so OpenTUI can recognize the following double/triple click.
  if (selection?.isStart && selection.behavior === "cell") return false
  return copy(renderer, toast, clipboard)
}

export function copy(renderer: Renderer, toast: Toast, clipboard: ClipboardService): boolean {
  const selection = renderer.getSelection()
  if (!selection) return false
  if (selection.isStart && selection.behavior === "cell") {
    renderer.clearSelection()
    return false
  }

  const text = selection.getSelectedText()
  if (!text) {
    renderer.clearSelection()
    return false
  }

  const focus = renderer.currentFocusedRenderable
  const clipboardText =
    focus?.getClipboardText && selection.selectedRenderables.includes(focus) ? focus.getClipboardText(text) : text

  clipboard
    .write(clipboardText)
    .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
    .catch(toast.error)

  // Keep the highlight. clearSelection() also resets OpenTUI's click
  // counter, so clearing here would turn a triple-click into a new single-click.
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
