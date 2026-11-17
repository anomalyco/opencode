const owners = new WeakSet<Element>()

/**
 * Registers `element` as owning the keyboard while focus is inside it, as a page's prompt in the browser pane does:
 * no command keybind or native menu key equivalent runs there, as none runs while one of the app's own dialogs is open.
 * Registration happens in code, so markup alone, such as a chat message's, cannot claim the keyboard. Returns the
 * release.
 */
export function ownKeyboard(element: Element) {
  owners.add(element)

  return () => void owners.delete(element)
}

/** Whether `target` is inside an element registered with `ownKeyboard`. */
export function keyboardOwned(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false

  return owners.has(target) || keyboardOwned(target.parentElement)
}
