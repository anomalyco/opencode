/** A key press in the page, with Electron's `Input` field names. */
export type PageKey = Pick<Electron.Input, "key" | "code" | "control" | "meta" | "shift" | "alt">

export type PageShortcut = {
  readonly key: string
  readonly code: string
  readonly ctrl: boolean
  readonly meta: boolean
  readonly shift: boolean
  readonly alt: boolean
}

// Unshifted chords with the platform's modifier that belong to the app shell or browser pane rather than the page:
// opening, closing or switching tabs, focusing the address field, opening settings, and toggling the file tree.
const shellKeys = ["t", "w", "l", "n", "1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "\\"]

// Shifted chords with the platform's modifier that belong to the app shell rather than the page: reopening a tab,
// switching side-panel tabs, toggling the side panel, opening the command palette, or running session commands. New Window and Close Window
// (⇧⌘N, ⇧⌘W) stay unclaimed: only their menu accelerators handle them, and claiming a chord also blocks the menu.
const shellShiftKeys = ["t", "[", "]", "r", "p", "l", "e", "o", "s"]

// The side panel's launchers: Review, Browser and Open file, with ⌃⌘ on macOS and Ctrl+Alt elsewhere. Only a typed
// Latin letter counts, so AltGr (Ctrl+Alt) typing on other layouts stays with the page.
const launcherKeys = ["r", "b", "p"]

/**
 * The letter a page key press names, as the app's keybinds read it: the layout's character, so Dvorak's C is "c"
 * although it sits on the physical I key. A layout that types no Latin letter falls back to the physical key.
 */
export function pageLetter(input: Pick<Electron.Input, "key" | "code">) {
  const key = input.key.toLowerCase()

  // ⇧[ types { on US layouts; a layout that types no ASCII on the bracket keys falls back to them.
  if (key === "{" || key === "}") return key === "{" ? "[" : "]"

  if (/^[^\x00-\x7f]$/u.test(key) && /^Bracket(Left|Right)$/.test(input.code))
    return input.code === "BracketLeft" ? "[" : "]"

  if (/^[a-z]$/.test(key) || !/^Key[A-Z]$/.test(input.code)) return key

  return input.code.slice(3).toLowerCase()
}

/**
 * Whether a page key press is the system browser's reload: F5, or the platform's modifier with R. The focused page
 * reloads itself; left to the window, the Reload menu item would reload the whole app.
 */
export function pageReload(input: PageKey, mac: boolean) {
  if (input.alt || input.shift) return false

  if (input.key === "F5") return !input.meta && !input.control

  return (mac ? input.meta && !input.control : input.control && !input.meta) && pageLetter(input) === "r"
}

/**
 * Returns the shortcut to forward to the app window when a focused page receives a key press that belongs to the
 * browser pane or app shell, or `undefined` when the key belongs to the page (typing, editing, clipboard, find,
 * history, or in-page shortcuts like ⌘K and ⌘B).
 */
export function pageShortcut(input: PageKey, mac: boolean): PageShortcut | undefined {
  const key = pageLetter(input)
  const mod = mac ? input.meta && !input.control : input.control && !input.meta
  const launcher = mac ? input.meta && input.control && !input.alt : input.control && input.alt && !input.meta

  const matched =
    (input.control && !input.meta && !input.alt && (key === "tab" || (key === "`" && !input.shift))) ||
    (launcher && !input.shift && launcherKeys.includes(input.key.toLowerCase())) ||
    (mod &&
      (input.alt
        ? !input.shift && (key === "arrowleft" || key === "arrowright")
        : input.shift
          ? shellShiftKeys.includes(key)
          : shellKeys.includes(key)))

  if (!matched) return undefined

  return {
    key: /^[a-z[\]]$/.test(key) ? key : input.key,
    code: input.code,
    ctrl: input.control,
    meta: input.meta,
    shift: input.shift,
    alt: input.alt,
  }
}
