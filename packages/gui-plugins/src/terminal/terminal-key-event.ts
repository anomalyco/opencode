export function terminalKeyInput(event: KeyboardEvent) {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return

  if (event.key.toLowerCase() !== "backspace") return

  return "\x15"
}

/** Shift+PageUp, PageDown, Home and End: the scrollback moves other terminals give these keys. */
export function terminalScrollKey(event: KeyboardEvent) {
  if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return

  if (event.key === "PageUp") return "page-up"

  if (event.key === "PageDown") return "page-down"

  if (event.key === "Home") return "top"

  if (event.key === "End") return "bottom"
}

// ghostty-web sends the raw character to the PTY for Command chords, so consume them here.
// Returning true makes ghostty-web preventDefault, so physical KeyV/KeyC are left alone
// (whatever character the layout gives them, e.g. RTL) so native paste and copy still run.
export function consumeTerminalMetaKey(
  event: KeyboardEvent,
  options?: {
    copy?: () => boolean
    paste?: () => void
  },
) {
  if (!event.metaKey || event.ctrlKey || event.altKey) return false

  if (event.code === "KeyV" || (event.code === "KeyC" && !event.shiftKey)) return false

  const key = event.key.toLowerCase()

  if (key === "v") {
    options?.paste?.()

    return true
  }

  if (key === "c" && !event.shiftKey && options?.copy?.()) return true

  return event.key.length === 1
}

/**
 * Where a click on a terminal link goes: nowhere without Ctrl, Cmd or Shift; a web link to the app's links (such as
 * the browser pane); a workspace file only to an app viewer. Never interpret terminal output as an OS command.
 */
export function terminalLinkTarget(
  event: Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "button">,
  text: string | undefined,
) {
  if ((!event.shiftKey && !event.ctrlKey && !event.metaKey) || event.altKey || event.button !== 0 || !text) return

  if (text.length > 4096 || text.trim() !== text || /[\\\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/u.test(text) || !URL.canParse(text)) return "blocked"
  const url = new URL(text)

  if (url.username || url.password) return "blocked"

  if (/^https?:\/\//i.test(text)) return event.shiftKey ? "system" : "app"

  if (url.protocol === "mailto:") return "system"

  if (url.protocol === "file:" && /^file:\/\/\/(?!\/)/i.test(text) && !url.host && !/%(?:2f|5c)/i.test(url.pathname)) return "file"

  return "blocked"
}
