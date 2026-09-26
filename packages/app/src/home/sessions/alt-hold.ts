import { makeEventListener } from "@solid-primitives/event-listener"
import { createStore } from "solid-js/store"

export function createAltHold(enabled: boolean, onPress: () => void) {
  const [state, setState] = createStore({ active: false })
  if (!enabled) return () => false

  makeEventListener(window, "keydown", (event) => {
    if (event.key !== "Alt" || state.active) return
    setState("active", true)
    onPress()
  })
  makeEventListener(window, "keyup", (event) => {
    if (event.key === "Alt") setState("active", false)
  })
  makeEventListener(window, "blur", () => setState("active", false))

  return () => state.active
}
