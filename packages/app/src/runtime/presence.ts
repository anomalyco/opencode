import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js"

// Keeps an element mounted while its CSS exit animation runs. Reduced motion needs no special case: when the styles
// drop the animation, the computed name is "none" and the element hides at once.
export function createPresence(props: { show: Accessor<boolean>; element: Accessor<HTMLElement | null> }) {
  const styles = createMemo(() => {
    const element = props.element()

    if (!element) return

    return getComputedStyle(element)
  })

  const animationName = () => styles()?.animationName ?? "none"
  const [state, setState] = createSignal<"present" | "hiding" | "hidden">(props.show() ? "present" : "hidden")
  // The last animation the element started. A different name when hiding means an exit animation is running.
  let started = "none"

  createEffect((previous) => {
    const show = props.show()

    untrack(() => {
      if (previous === show) return

      if (show) {
        // Forget the previous exit animation so the next hide runs it again.
        started = "none"

        return setState("present")
      }

      const current = animationName()

      if (current === "none" || styles()?.display === "none") return setState("hidden")

      setState(started === current ? "hidden" : "hiding")
    })

    return show
  }, props.show())

  createEffect(() => {
    const element = props.element()

    if (!element) return

    const start = (event: AnimationEvent) => {
      if (event.target === element) started = animationName()
    }

    const end = (event: AnimationEvent) => {
      if (event.target === element && animationName().includes(event.animationName) && state() === "hiding")
        setState("hidden")
    }

    element.addEventListener("animationstart", start)
    element.addEventListener("animationcancel", end)
    element.addEventListener("animationend", end)

    onCleanup(() => {
      element.removeEventListener("animationstart", start)
      element.removeEventListener("animationcancel", end)
      element.removeEventListener("animationend", end)
    })
  })

  return { present: () => state() !== "hidden", state }
}
