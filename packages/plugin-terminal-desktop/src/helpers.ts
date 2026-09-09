export function focusTerminalById(id: string) {
  const terminal = document.getElementById(`terminal-wrapper-${id}`)?.querySelector('[data-component="terminal"]')
  if (!(terminal instanceof HTMLElement)) return false
  const textarea = terminal.querySelector("textarea")
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.focus({ preventScroll: true })
    return true
  }
  terminal.focus({ preventScroll: true })
  terminal.dispatchEvent(
    typeof PointerEvent === "function"
      ? new PointerEvent("pointerdown", { bubbles: true, cancelable: true })
      : new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
  )
  return true
}
