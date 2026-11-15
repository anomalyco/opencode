import { createEffect, onCleanup } from "solid-js"

/**
 * While a chart tooltip is open, close it when a pointer goes down outside the chart or the chart scrolls fully
 * out of view. Chart pointerleave handlers ignore touch so a tap keeps its tooltip, and on narrow screens the
 * tooltip is a fixed bottom sheet, so without this a tapped tooltip stays pinned over the rest of the page.
 */
export function dismissChartTooltipOnExit(input: {
  chart: () => HTMLElement | undefined
  open: () => boolean
  dismiss: () => void
}) {
  createEffect(() => {
    const chart = input.chart()
    if (!chart || !input.open()) return
    const dismissOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && chart.contains(event.target)) return
      input.dismiss()
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => !entry.isIntersecting)) input.dismiss()
    })
    document.addEventListener("pointerdown", dismissOutsidePointer, true)
    observer.observe(chart)
    onCleanup(() => {
      document.removeEventListener("pointerdown", dismissOutsidePointer, true)
      observer.disconnect()
    })
  })
}
