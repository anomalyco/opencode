import NumberFlow from "number-flow"
import { createEffect, onCleanup, onMount } from "solid-js"

export function RollingNumber(props: {
  value: number
  timing: () => { duration: number; easing: string; spinEasing: string }
}) {
  let root!: HTMLSpanElement
  // Keep the server-rendered text stable while the custom element owns its contents.
  const initial = props.value.toLocaleString()

  onMount(() => {
    if (new Intl.NumberFormat().resolvedOptions().numberingSystem !== "latn") {
      createEffect(() => {
        root.textContent = props.value.toLocaleString()
      })
      return
    }

    const flow = new NumberFlow()
    flow.format = { useGrouping: true, maximumFractionDigits: 0 }
    flow.trend = 1
    flow.opacityTiming = { duration: 180, easing: "ease-out" }
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const updateMotion = () => {
      flow.animated = !motion.matches
    }
    updateMotion()
    motion.addEventListener("change", updateMotion)
    onCleanup(() => motion.removeEventListener("change", updateMotion))
    root.replaceChildren(flow)
    createEffect(() => {
      const value = props.value
      if (flow.value === value) return
      const timing = props.timing()
      flow.transformTiming = { duration: timing.duration, easing: timing.easing }
      flow.spinTiming = { duration: timing.duration, easing: timing.spinEasing }
      flow.update(value)
    })
  })

  return (
    <span data-value ref={root}>
      {initial}
    </span>
  )
}
