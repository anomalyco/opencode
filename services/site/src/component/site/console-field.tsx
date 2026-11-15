import { createEffect, on, onCleanup, onMount } from "solid-js"
import { consoleDots } from "./console-dots"

/** The Console section's dot backdrop (console-dots.ts). */
export function ConsoleField(props: { dot?: number }) {
  // Dot size in CSS pixels: 2 by default, 1 for the inline and slim options, like the Console site.
  const dot = () => props.dot ?? 2
  let field: HTMLDivElement | undefined

  onMount(() => {
    if (!field) return
    const dots = consoleDots(field, dot)
    // Redraw when the dot size changes (switching between Console options).
    createEffect(on(dot, dots.draw, { defer: true }))
    onCleanup(dots.stop)
  })

  return <div data-component="console-field" data-dot={dot()} ref={field} aria-hidden="true" />
}
