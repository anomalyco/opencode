/**
 * Copies text with a hidden text field and the old copy command, keeping the focus where it was:
 * the fallback for embedded browsers that block the Clipboard API.
 */
export function copySelection(text: string) {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none"
  document.body.append(area)
  area.select()
  const copied = document.execCommand("copy")
  area.remove()
  active?.focus({ preventScroll: true })
  return copied
}

/**
 * Handlers for a command that copies like its row's Copy button: a plain click or tap copies. A drag
 * (selecting part of the command) and a double or triple click (selecting a word or the line) don't,
 * so the text stays selectable. Spread them onto the command element.
 */
export function copyOnClick(copy: (command: HTMLElement) => void) {
  let start = { x: 0, y: 0 }
  return {
    onPointerDown: (event: PointerEvent) => (start = { x: event.clientX, y: event.clientY }),
    onClick: (event: MouseEvent & { currentTarget: HTMLElement }) => {
      if (event.detail > 1 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return
      copy(event.currentTarget)
    },
  }
}
