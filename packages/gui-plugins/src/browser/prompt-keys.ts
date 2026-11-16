// Who a key pressed in the app window belongs to while a page prompt (alert, confirm, prompt, "Leave site?", a
// sign-in) is open in the pane. The prompt is modal for its tab: while the keyboard is inside it, the app's command
// keybinds do not run (the command layer skips a key whose target is inside an `aria-modal` dialog, as it skips every
// key while one of the app's own dialogs is open), and the prompt cancels what the window itself would do behind it.
// Keys outside the prompt are the app's.

export type PromptKey = {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly isComposing: boolean
}

export type PromptKeyOwner =
  /** The prompt answers or moves within itself: Enter accepts, Escape cancels, Tab and Shift+Tab cycle. */
  | "prompt"
  /** The focused field or button, as its default does: typing, moving the caret, clipboard, undo. */
  | "field"
  /** The window, as Chrome leaves them to a window with a tab-modal dialog: close or new window, quit, hide, full screen. */
  | "window"
  /** Nothing: an app or pane shortcut (reload, find, zoom, history, tabs, the address field, the agent, the palette). */
  | "swallowed"
  /** The keyboard is elsewhere, such as the chat composer: the app's shortcuts as usual, and the prompt stays open. */
  | "app"

const modifiers: readonly string[] = ["Alt", "AltGraph", "CapsLock", "Control", "Fn", "Meta", "NumLock", "Shift"]

const caret: readonly string[] = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Backspace", "Delete"]

// Text editing on the command key (Ctrl on Windows and Linux): select all, copy, cut, paste, undo and redo.
const editing: readonly string[] = ["a", "c", "x", "v", "z"]

/** Who `key` belongs to: `inside` is whether the keyboard is inside the open prompt. */
export function promptKeyOwner(key: PromptKey, input: { readonly inside: boolean; readonly mac: boolean }): PromptKeyOwner {
  if (!input.inside) return "app"

  if (key.isComposing || modifiers.includes(key.key)) return "field"
  const name = key.key.length === 1 ? key.key.toLowerCase() : key.key
  const command = input.mac ? key.metaKey : key.ctrlKey
  const control = input.mac && key.ctrlKey
  const plain = !key.ctrlKey && !key.metaKey && !key.altKey

  if (plain && (name === "Enter" || name === "Escape" || name === "Tab")) return "prompt"

  if (plain) return /^F\d{1,2}$/.test(name) ? "swallowed" : "field"

  if (windowChord(name, key, input.mac)) return "window"

  // macOS edits text on Option (words) and Control (Emacs bindings) too; Windows uses Alt for menus and history.
  if (input.mac && key.altKey && !key.metaKey && !key.ctrlKey) return "field"

  if (control && !key.metaKey && !key.altKey) return name === "Tab" ? "swallowed" : "field"

  if (command && !key.altKey && !(input.mac ? key.ctrlKey : key.metaKey)) {
    if (editing.includes(name) || (!input.mac && name === "y" && !key.shiftKey) || caret.includes(name)) return "field"
  }

  return "swallowed"
}

function windowChord(name: string, key: PromptKey, mac: boolean) {
  if (mac) {
    if (key.metaKey && key.ctrlKey && !key.altKey && name === "f") return true

    if (!key.metaKey || key.ctrlKey) return false

    if (!key.shiftKey && !key.altKey) return name === "q" || name === "h" || name === "m" || name === "`"

    if (key.altKey && !key.shiftKey) return name === "h"

    return key.shiftKey && !key.altKey && (name === "w" || name === "n")
  }

  return key.ctrlKey && key.shiftKey && !key.altKey && !key.metaKey && (name === "w" || name === "n")
}
