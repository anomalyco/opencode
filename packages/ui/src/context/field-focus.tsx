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

// Focus moved into a field for a control the user acted on keeps that control's ring state: none after a click, a ring
// after the keyboard. Undefined when the field already has focus, so its own state stays.
export function handoffRing(element: HTMLElement | undefined) {
  const active = document.activeElement

  if (active && active === element) return undefined

  return active instanceof HTMLElement && active.matches(":focus-visible")
}

export function handOffFocus(element: HTMLElement, options?: FocusOptions) {
  const visible = handoffRing(element)

  if (visible !== undefined) focusField(element, visible, options)
}

export function createFieldFocus() {
  const [visible, setVisible] = createSignal(false)

  let pointer = false
  let returning = false
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
      setVisible(restoring.get(element) ?? (!pointer && !returning))
      returning = false
      clearPointer()
    },
    leave: (event: FocusEvent) => {
      // Switching to another window blurs the field but leaves it the active element, and focus returns to it on the way
      // back. That return isn't the user moving focus to the field, so it shows no ring.
      returning = event.currentTarget === document.activeElement
      setVisible(false)
      clearPointer()
    },
  }
}
