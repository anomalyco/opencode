import type { JSX } from "solid-js"
import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { useSpring } from "./motion-spring"

export function TextStrikethrough(props: {
  /** Whether the strikethrough is active (line drawn across). */
  active: boolean
  /** The text to display. Rendered twice internally (base + decoration overlay). */
  text: string
  /** Spring visual duration in seconds. Default 0.35. */
  visualDuration?: number
  class?: string
  style?: JSX.CSSProperties
}) {
  const progress = useSpring(
    () => (props.active ? 1 : 0),
    () => ({ visualDuration: props.visualDuration ?? 0.35, bounce: 0 }),
  )

  let baseRef: HTMLSpanElement | undefined
  let containerRef: HTMLSpanElement | undefined
  const [textWidth, setTextWidth] = createSignal(0)
  const [containerWidth, setContainerWidth] = createSignal(0)

  const measure = () => {
    if (baseRef) setTextWidth(baseRef.scrollWidth)
    if (containerRef) setContainerWidth(containerRef.offsetWidth)
  }

  onMount(measure)

  createEffect(() => {
    const el = containerRef
    if (!el) return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  })

  // Revealed pixels from left = progress * textWidth
  const revealedPx = () => {
    const tw = textWidth()
    return tw > 0 ? progress() * tw : 0
  }

  // Overlay clip: hide everything to the right of revealed area
  const overlayClip = () => {
    const cw = containerWidth()
    const tw = textWidth()
    if (cw <= 0 || tw <= 0) return `inset(0 ${(1 - progress()) * 100}% 0 0)`
    const remaining = Math.max(0, cw - revealedPx())
    return `inset(0 ${remaining}px 0 0)`
  }

  // Base clip: hide everything to the left of revealed area (complementary)
  const baseClip = () => {
    const px = revealedPx()
    if (px <= 0.5) return "none"
    return `inset(0 0 0 ${px}px)`
  }

  return (
    <span
      data-component="text-strikethrough"
      class={props.class}
      style={{ display: "grid", ...props.style }}
      ref={containerRef}
    >
      <span ref={baseRef} style={{ "grid-area": "1 / 1", "clip-path": baseClip() }}>
        {props.text}
      </span>
      <span
        aria-hidden="true"
        style={{
          "grid-area": "1 / 1",
          "text-decoration": "line-through",
          "pointer-events": "none",
          "clip-path": overlayClip(),
        }}
      >
        {props.text}
      </span>
    </span>
  )
}
