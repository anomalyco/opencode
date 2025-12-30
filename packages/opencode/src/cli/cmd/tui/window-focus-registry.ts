// Plain JS registry - NO SolidJS reactivity
// This avoids render loops by keeping focus management outside the reactive system

type Focusable = { focus: () => void }

const registry = new Map<string, Focusable>()

export const WindowFocusRegistry = {
  register(windowID: string, focusable: Focusable) {
    registry.set(windowID, focusable)
    return () => {
      registry.delete(windowID)
    }
  },

  focus(windowID: string) {
    // Small delay to ensure component is fully mounted/rendered
    setTimeout(() => {
      const element = registry.get(windowID)
      if (element) {
        element.focus()
      }
    }, 50)
  },

  has(windowID: string) {
    return registry.has(windowID)
  },
}
