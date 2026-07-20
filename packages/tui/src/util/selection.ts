import type { ClipboardService } from "../context/clipboard"
import { MouseButton, type MouseEvent, type Renderable } from "@opentui/core"

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

export type PluginSelectionPayload = {
  text: string
  x: number
  y: number
  renderables: readonly Renderable[]
}

type SelectionRenderer = {
  getSelection: () => { getSelectedText: () => string; selectedRenderables: readonly Renderable[] } | null
  clearSelection: () => void
}

export function startPluginSelection(
  _renderer: Pick<SelectionRenderer, "clearSelection">,
  event: MouseEvent,
  armed: boolean,
): boolean {
  return armed && event.button === MouseButton.LEFT
}

export function capturePluginSelection(
  renderer: Pick<SelectionRenderer, "getSelection" | "clearSelection">,
  event: MouseEvent,
  publish: (payload: PluginSelectionPayload) => void,
  started = false,
): boolean {
  if (!started) return false
  const selection = renderer.getSelection()
  const text = selection?.getSelectedText().trim()
  if (selection && text) {
    publish({ text, x: event.x, y: event.y, renderables: selection.selectedRenderables })
  }
  renderer.clearSelection()
  event.preventDefault()
  event.stopPropagation()
  return true
}

export function copy(renderer: Renderer, toast: Toast, clipboard: ClipboardService): boolean {
  const selection = renderer.getSelection()
  if (!selection) return false

  const text = selection.getSelectedText()
  if (!text) return false

  const focus = renderer.currentFocusedRenderable
  const clipboardText =
    focus?.getClipboardText && selection.selectedRenderables.includes(focus) ? focus.getClipboardText(text) : text

  clipboard
    ?.write?.(clipboardText)
    .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
    .catch(toast.error)

  renderer.clearSelection()
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
