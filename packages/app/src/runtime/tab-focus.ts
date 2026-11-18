import { createEventListener } from "@solid-primitives/event-listener"
import { createSignal } from "solid-js"

export function createTabFocus() {
  const [visible, setVisible] = createSignal(false)

  // Editable elements also match :focus-visible after a click or autofocus. Only ring the frame on Tab entry.
  let tabbing = false

  createEventListener(
    document,
    "keydown",
    (event) => {
      if (event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey) tabbing = true
    },
    true,
  )
  createEventListener(
    document,
    "keyup",
    (event) => {
      if (event.key === "Tab") tabbing = false
    },
    true,
  )
  createEventListener(
    document,
    "pointerdown",
    () => {
      tabbing = false
      setVisible(false)
    },
    true,
  )

  return { visible, enter: () => setVisible(tabbing) }
}
