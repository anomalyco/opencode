import type { SelectionBehavior } from "@opentui/core"
import type { CopyMode } from "../config"
import type { ClipboardSelections, ClipboardService } from "../context/clipboard"

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
  currentFocusedEditor?: FocusableSelectionTarget | null
}

type SelectionKeyEvent = {
  ctrl?: boolean
  baseCode?: number
  name: string
  preventDefault: () => void
  stopPropagation: () => void
}

export function copyOnSelectRelease(
  event: { isDragging?: boolean },
  renderer: Renderer,
  toast: Toast,
  clipboard: ClipboardService,
  mode: CopyMode = "select",
): boolean {
  if (!event.isDragging || mode === "manual") return false
  return copy(renderer, toast, clipboard, releaseSelections[mode])
}

const releaseSelections = {
  select: ["clipboard"],
  primary: ["primary"],
  both: ["clipboard", "primary"],
} as const satisfies Record<Exclude<CopyMode, "manual">, ClipboardSelections>

export function copy(
  renderer: Renderer,
  toast: Toast,
  clipboard: ClipboardService,
  selections: ClipboardSelections = ["clipboard"],
): boolean {
  const selection = renderer.getSelection()
  if (!selection) return false
  if (selection.isStart && selection.behavior === "cell") return false

  const text = selection.getSelectedText()
  if (!text) return false

  const focus = renderer.currentFocusedRenderable
  const clipboardText =
    focus?.getClipboardText && selection.selectedRenderables.includes(focus) ? focus.getClipboardText(text) : text

  const write = clipboard.write(clipboardText, selections)
  // Like a native selection, a primary-only update is silent and best effort.
  if (!selections.includes("clipboard")) {
    void write.catch(() => {})
    return true
  }
  write.then(() => toast.show({ message: "Copied to clipboard", variant: "info" })).catch(toast.error)

  // Copy never clears selection, including empty releases: clearing also resets multi-click history.
  return true
}

export function handleSelectionKey(
  renderer: Renderer,
  toast: Toast,
  event: SelectionKeyEvent,
  clipboard: ClipboardService,
  copyOnSelect: boolean,
) {
  const selection = renderer.getSelection()
  if (!selection) return
  const focus = renderer.currentFocusedEditor
  const editing = focus?.hasSelection() && selection.selectedRenderables.includes(focus)

  // Kitty can report a non-Latin key name with a Latin base-layout C.
  if (event.ctrl && (event.name === "c" || event.baseCode === 99 || event.baseCode === 67)) {
    if ((copyOnSelect && !editing) || !copy(renderer, toast, clipboard)) {
      renderer.clearSelection()
      return
    }

    event.preventDefault()
    event.stopPropagation()
    return
  }

  if (event.name === "escape") {
    const text = selection.isStart && selection.behavior === "cell" ? "" : selection.getSelectedText()
    renderer.clearSelection()
    if (!text) return
    event.preventDefault()
    event.stopPropagation()
    return
  }

  if (editing) return

  renderer.clearSelection()
}

export * as Selection from "./selection"
