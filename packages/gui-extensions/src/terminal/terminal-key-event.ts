export function terminalKeyInput(event: KeyboardEvent) {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return

  if (event.key.toLowerCase() !== "backspace") return

  return "\x15"
}

export function consumeTerminalMetaKey(
  event: KeyboardEvent,
  options?: {
    copy?: () => boolean
    paste?: () => void
  },
) {
  if (!event.metaKey || event.ctrlKey || event.altKey) return false

  const key = event.key.toLowerCase()

  // ghostty-web only exempts physical KeyV from KeyEncoder.encode; on non-QWERTY
  // layouts where "v" lives on another physical key, trigger paste without
  // falling through to KeyEncoder.encode.
  if (key === "v") {
    if (event.code === "KeyV") return false

    options?.paste?.()

    return true
  }

  if (!event.shiftKey && key === "c") {
    if (options?.copy?.()) return true

    return event.code !== "KeyC"
  }

  // ghostty-web passes ASCII `utf8` to KeyEncoder.encode, which ignores Mods.SUPER
  // in standard VT100 mode and emits the raw character to the PTY.
  return event.key.length === 1
}
