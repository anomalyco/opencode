import { createSignal, onCleanup, onMount, untrack } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createSizingState, isSizingActive, transitionSizing, type SizingEvent } from "./sizing-machine"

export const createSizing = () => {
  const [state, setState] = createSignal(createSizingState())
  let timer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: SizingEvent) => {
    const prev = untrack(state)
    const result = transitionSizing(prev, event)

    if (result.state !== prev) setState(result.state)
    result.effects.forEach((effect) => {
      clearTimeout(timer)
      timer = undefined

      if (effect.type === "cancel-settle") return
      timer = setTimeout(() => dispatch({ type: "settle.due", attempt: effect.attempt }), effect.delayMs)
    })
  }

  onMount(() => {
    makeEventListener(window, "pointerup", () => dispatch({ type: "pointer.up" }))
    makeEventListener(window, "pointercancel", () => dispatch({ type: "pointer.up" }))
    makeEventListener(window, "blur", () => dispatch({ type: "reset" }))
  })

  onCleanup(() => dispatch({ type: "reset" }))

  return {
    active: () => isSizingActive(state()),
    // Only the primary button drags a resize handle.
    start(event: PointerEvent) {
      if (event.button !== 0) return
      dispatch({ type: "pointer.down" })
    },
    touch: () => dispatch({ type: "resize.touched" }),
  }
}

export type Sizing = ReturnType<typeof createSizing>
