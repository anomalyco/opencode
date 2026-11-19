import { createSignal, onCleanup } from "solid-js"

const restoring = new WeakMap<HTMLElement, boolean>()

const fieldRings = new WeakMap<HTMLElement, (visible: boolean) => void>()

export function focusField(element: HTMLElement, visible: boolean, options?: FocusOptions) {
  if (document.activeElement === element) {
    fieldRings.get(element)?.(visible)

    return
  }

  restoring.set(element, visible)

  try {
    element.focus(options)
  } finally {
    restoring.delete(element)
  }
}

export function createFieldFocus() {
  const [visible, setVisible] = createSignal(false)

  let pointer = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const clearPointer = () => {
    clearTimeout(timer)
    pointer = false
  }

  onCleanup(clearPointer)

  return {
    visible,
    pointer: () => {
      clearPointer()
      pointer = true
      // Native focus follows this event's default action. Don't carry the press into a later focus.
      timer = setTimeout(clearPointer, 0)
      setVisible(false)
    },
    enter: (element: HTMLElement) => {
      fieldRings.set(element, setVisible)
      setVisible(restoring.get(element) ?? !pointer)
      clearPointer()
    },
    leave: () => {
      setVisible(false)
      clearPointer()
    },
  }
}
