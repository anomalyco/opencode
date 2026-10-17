import { performance } from "perf_hooks"

// One physical keypress can occasionally surface as two identical key events
// from the OS and Electron layers, the same class of bug the TUI guards
// against at the stdin boundary (opencode issue #4920). A duplicate is an
// identical key event reappearing within a few milliseconds of the original —
// faster than OS key auto-repeat, marked separately anyway, and faster than
// any human double press. Text insertion is the visible victim, so the guard
// only covers printable characters and the editing keys. Composition events
// (IME) are never touched.

const DUPLICATE_WINDOW_MS = 6
const EDITING_KEYS = new Set(["Backspace", "Delete", "Enter", "Tab", "Escape"])

export function createDuplicateKeyGuard(): (event: KeyboardEvent) => void {
  let last: string | undefined
  let lastAcceptedAt = 0

  return (event) => {
    // Auto-repeat is a separate event kind and composition feeds IME text;
    // neither may be deduplicated away.
    if (event.repeat || event.isComposing) return

    const { key } = event
    if (key.length !== 1 && !EDITING_KEYS.has(key)) return

    const signature = `${key}\u0000${event.metaKey}\u0000${event.ctrlKey}\u0000${event.altKey}\u0000${event.shiftKey}`
    const at = performance.now()
    if (signature === last && at - lastAcceptedAt < DUPLICATE_WINDOW_MS) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }

    last = signature
    lastAcceptedAt = at
  }
}
