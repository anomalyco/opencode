export function terminalKeyInput(event: KeyboardEvent) {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
  if (event.key.toLowerCase() !== "backspace") return
  return "\x15"
}
