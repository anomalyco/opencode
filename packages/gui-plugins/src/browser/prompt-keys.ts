import { pageLetter } from "./keys"

// Who a key pressed in the app window belongs to while a page prompt (alert, confirm, prompt, "Leave site?", a
// sign-in) is open in the pane. The prompt is modal for its tab: while the keyboard is inside it, the app's command
// keybinds and the native menu's key equivalents do not run (the prompt is a modal alert dialog), and the
// prompt cancels what the window itself would do behind it. Keys outside the prompt are the app's.

export type PromptKey = Pick<
  KeyboardEvent,
  "key" | "code" | "keyCode" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing" | "getModifierState"
>

export type PromptKeyOwner =
  /** The prompt answers or moves within itself: Enter accepts, Escape cancels, Tab and Shift+Tab cycle. */
  | "prompt"
  /** The focused field or button, as its default does: typing, moving the caret, clipboard, undo, the context menu. */
  | "field"
  /** The window or the system, as Chrome leaves them with a tab-modal dialog: close or new window, quit, hide, full screen. */
  | "window"
  /**
   * The keyboard leaves the prompt for the pane's address field, which stays open: F6, Shift+F6 and the address
   * shortcut, as they leave a tab-modal dialog in Chrome. Escape would cancel the prompt.
   */
  | "exit"
  /** Nothing: an app or pane shortcut (reload, find, zoom, history, tabs, the agent, the palette). */
  | "swallowed"
  /** The keyboard is elsewhere, such as the chat composer: the app's shortcuts as usual, and the prompt stays open. */
  | "app"

const modifiers: readonly string[] = ["Alt", "AltGraph", "CapsLock", "Control", "Fn", "Meta", "NumLock", "Shift"]

const caret: readonly string[] = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Backspace", "Delete"]

// Text editing on the command key (Ctrl on Windows and Linux): select all, copy, cut, paste, undo; with Shift only redo
// and paste as plain text.
const editing: readonly string[] = ["a", "c", "x", "v", "z"]

const shiftedEditing: readonly string[] = ["z", "v"]

/**
 * Who `key` belongs to: `inside` is whether the keyboard is inside the open prompt, `text` whether it is in one of
 * the prompt's text fields.
 */
export function promptKeyOwner(
  key: PromptKey,
  input: { readonly inside: boolean; readonly mac: boolean; readonly text: boolean },
): PromptKeyOwner {
  if (!input.inside) return "app"

  // Chromium reports the key that ends an IME composition with keyCode 229 once isComposing is already false.
  if (key.isComposing || key.keyCode === 229 || modifiers.includes(key.key)) return "field"

  if (!input.mac && altGraph(key)) return "field"

  // A layout that types no Latin letter names the physical key, so its Ctrl+V still pastes.
  const name = key.key.length === 1 ? pageLetter(key) : key.key
  const backquote = name === "`" || key.code === "Backquote"
  const command = input.mac ? key.metaKey : key.ctrlKey
  const plain = !key.ctrlKey && !key.metaKey && !key.altKey

  if (plain && (name === "Enter" || name === "Escape" || name === "Tab")) return "prompt"

  if (plain && name === "F6") return "exit"

  if (command && !key.shiftKey && !key.altKey && !(input.mac ? key.ctrlKey : key.metaKey) && name === "l") return "exit"

  // Shift+F10 opens the field's context menu on Windows and Linux.
  if (plain) return /^F\d{1,2}$/.test(name) && !(!input.mac && key.shiftKey && name === "F10") ? "swallowed" : "field"

  if (windowChord(name, backquote, key, input.mac)) return "window"

  if (input.mac) {
    // The emoji and symbols picker types into the field.
    if (key.ctrlKey && key.metaKey && !key.altKey && name === " ") return "field"

    // macOS edits text on Option (words) and Control (Emacs bindings). The menu takes what the field leaves: Option+Up
    // and Down off a text field switch the session, Control+` toggles the terminal.
    if (key.altKey && !key.metaKey && !key.ctrlKey)
      return !input.text && (name === "ArrowUp" || name === "ArrowDown") ? "swallowed" : "field"

    if (key.ctrlKey && !key.metaKey && !key.altKey) return name === "Tab" || backquote ? "swallowed" : "field"
  }

  if (command && !key.altKey && !(input.mac ? key.ctrlKey : key.metaKey)) {
    if (caret.includes(name)) return "field"

    if (key.shiftKey && shiftedEditing.includes(name)) return "field"

    // Ctrl+Insert copies on Windows and Linux.
    if (!key.shiftKey && (editing.includes(name) || (!input.mac && (name === "y" || name === "Insert")))) return "field"
  }

  return "swallowed"
}

// AltGr types a layout's @, {, € or ą, and its dead keys. Windows reports it as Ctrl+Alt, as it does Ctrl+Alt pressed
// for it; Linux may report AltGraph alone.
function altGraph(key: PromptKey) {
  if (!/^.$/u.test(key.key) && key.key !== "Dead") return false

  return key.getModifierState("AltGraph") || (key.ctrlKey && key.altKey && !key.metaKey)
}

function windowChord(name: string, backquote: boolean, key: PromptKey, mac: boolean) {
  if (mac) {
    if (key.metaKey && key.ctrlKey && !key.altKey && name === "f") return true

    if (!key.metaKey || key.ctrlKey) return false

    if (!key.shiftKey && !key.altKey) return name === "q" || name === "h" || name === "m" || backquote

    if (key.altKey && !key.shiftKey) return name === "h"

    return key.shiftKey && !key.altKey && (name === "w" || name === "n" || backquote)
  }

  if (key.altKey && !key.ctrlKey && !key.metaKey && !key.shiftKey && name === "F4") return true

  return key.ctrlKey && key.shiftKey && !key.altKey && !key.metaKey && (name === "w" || name === "n")
}
