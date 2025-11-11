/**
 * Keyboard shortcuts handler for openTUI web
 *
 * Provides centralized keyboard shortcut management with modifier key detection.
 * Prevents interference with text input fields.
 */

export type KeyboardShortcut = {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  meta?: boolean
  description: string
  action: () => void
}

export type KeyboardHandlerOptions = {
  shortcuts: KeyboardShortcut[]
  enabled?: boolean
}

/**
 * Checks if the event target is an input element where typing should not be intercepted
 */
const isInputElement = (target: EventTarget | null): boolean => {
  if (!target || !(target instanceof HTMLElement)) return false

  const tagName = target.tagName.toLowerCase()
  const isContentEditable = target.isContentEditable

  return tagName === "input" || tagName === "textarea" || tagName === "select" || isContentEditable
}

/**
 * Checks if keyboard event matches shortcut definition
 */
const matchesShortcut = (event: KeyboardEvent, shortcut: KeyboardShortcut): boolean => {
  const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase()
  const ctrlMatch = shortcut.ctrl ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey
  const shiftMatch = shortcut.shift ? event.shiftKey : !event.shiftKey
  const altMatch = shortcut.alt ? event.altKey : !event.altKey

  return keyMatch && ctrlMatch && shiftMatch && altMatch
}

/**
 * Create a keyboard event handler
 */
export const createKeyboardHandler = (options: KeyboardHandlerOptions) => {
  const handleKeyDown = (event: KeyboardEvent) => {
    // Don't intercept if handler is disabled
    if (options.enabled === false) return

    // Don't intercept typing in input fields (except for specific shortcuts like Escape)
    if (isInputElement(event.target) && event.key !== "Escape") {
      return
    }

    // Find matching shortcut
    for (const shortcut of options.shortcuts) {
      if (matchesShortcut(event, shortcut)) {
        event.preventDefault()
        event.stopPropagation()
        shortcut.action()
        return
      }
    }
  }

  return {
    handleKeyDown,
    attach: () => {
      window.addEventListener("keydown", handleKeyDown)
    },
    detach: () => {
      window.removeEventListener("keydown", handleKeyDown)
    },
  }
}

/**
 * Format shortcut for display (e.g., "Ctrl+X N")
 */
export const formatShortcut = (shortcut: KeyboardShortcut): string => {
  const parts: string[] = []

  if (shortcut.ctrl) parts.push("Ctrl")
  if (shortcut.shift) parts.push("Shift")
  if (shortcut.alt) parts.push("Alt")
  if (shortcut.meta) parts.push("Meta")

  parts.push(shortcut.key.toUpperCase())

  return parts.join("+")
}

/**
 * Hook for managing keyboard shortcuts in SolidJS components
 */
export const useKeyboardShortcuts = (shortcuts: KeyboardShortcut[], enabled = true) => {
  const handler = createKeyboardHandler({ shortcuts, enabled })

  return {
    attach: handler.attach,
    detach: handler.detach,
  }
}
