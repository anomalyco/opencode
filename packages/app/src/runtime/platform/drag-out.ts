import type { Platform } from "./platform"

type DragOut = { readonly path: string; readonly text: string }

type DragOutState = { current: DragOut | undefined }

// The file drag handed to the system, with the `text/plain` the app's own drag carried, until the drag ends. A drop
// back into the app then reads as that drag did, not as a file from another app.
const state: DragOutState = { current: undefined }

/**
 * Hands a file row's `dragstart` to the system's drag, so the file drops into other apps as the file itself. False
 * when the platform has no system drag; the event's own drag goes on then. When the system drag ends, the row gets
 * the `dragend` its cancelled drag never fired, so whatever started dragging it can finish.
 */
export function startDragOut(platform: Pick<Platform, "startFileDrag">, event: DragEvent, path: string) {
  if (!platform.startFileDrag || !event.dataTransfer) return false
  const drag = { path, text: event.dataTransfer.getData("text/plain") }
  // The row may sit in a shadow root (the file tree's does), where `target` is retargeted to its host.
  const source = event.composedPath()[0] ?? event.target
  event.preventDefault()
  state.current = drag

  const end = () => {
    if (state.current === drag) state.current = undefined
    source?.dispatchEvent(new DragEvent("dragend", { bubbles: true, composed: true }))
  }

  void platform.startFileDrag(path).then(end, end)

  return true
}

/** Whether a drag handed to the system is under way. */
export function draggingOut() {
  return state.current !== undefined
}

/** The text the app's own drag carried, when the dropped files are the drag handed to the system. */
export function dragOutText(paths: readonly string[]) {
  const drag = state.current

  if (!drag || paths.length !== 1 || !sameFile(paths[0] ?? "", drag.path)) return

  return drag.text
}

// The system drag is Windows-only, where paths ignore case, take either separator and may end in one.
function sameFile(a: string, b: string) {
  const key = (value: string) => value.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase()

  return key(a) === key(b)
}
