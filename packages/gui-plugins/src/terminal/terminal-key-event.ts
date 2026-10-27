export function terminalKeyInput(event: KeyboardEvent) {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return

  if (event.key.toLowerCase() !== "backspace") return

  return "\x15"
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
