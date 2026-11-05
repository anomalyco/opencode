import { createEffect, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { designCopy } from "~/component/site/design-copy"
import type { CopyId } from "~/component/site/design-mode"
import { fontContent } from "~/lib/font-content"

export type Tone = "paper" | "ink" | "blue" | "night"

const total = fontContent.plates.length
const pad = (value: number, length = 2) => String(value).padStart(length, "0")

/**
 * One plate of the specimen: a hairline header in mono (number, title, edition), a lead in Inter,
 * then the plate's own composition. Plates are numbered in the order of `fontContent.plates`.
 */
export function Plate(props: {
  id: string
  tone?: Tone
  lead?: string
  /** Design mode copy id for the lead, so its alternatives can be cycled in place. */
  copy?: CopyId
  aside?: string
  class?: string
  children: JSX.Element
}) {
  const index = fontContent.plates.findIndex((plate) => plate.id === props.id) + 1
  const title = fontContent.plates[index - 1]?.title ?? props.id
  return (
    <section
      id={props.id}
      data-plate={props.id}
      data-tone={props.tone ?? "paper"}
      class={props.class}
      aria-labelledby={`${props.id}-title`}
    >
      <header data-slot="plate-head">
        <span data-anno>
          Pl. {pad(index)}/{pad(total)}
        </span>
        <h2 id={`${props.id}-title`} data-anno>
          {title}
        </h2>
        <span data-anno data-slot="plate-aside">
          {props.aside ?? "OpenCode Font · Specimen 1.001"}
        </span>
      </header>
      {props.lead && (
        <p data-slot="plate-lead" data-design-copy={props.copy}>
          {props.copy ? designCopy(props.copy, props.lead) : props.lead}
        </p>
      )}
      {props.children}
    </section>
  )
}

/** True while `element` is near the viewport, so animations can pause offscreen. */
export function useVisible(element: () => Element | undefined, margin = "200px 0px") {
  const [visible, setVisible] = createSignal(false)
  onMount(() => {
    const target = element()
    if (!target) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: margin })
    observer.observe(target)
    onCleanup(() => observer.disconnect())
  })
  return visible
}

/** Turns true once, the first time `element` scrolls into view: for entrance animations. */
export function useSeen(element: () => Element | undefined) {
  const [seen, setSeen] = createSignal(false)
  onMount(() => {
    const target = element()
    if (!target) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setSeen(true)
        observer.disconnect()
      },
      { threshold: 0.2 },
    )
    observer.observe(target)
    onCleanup(() => observer.disconnect())
  })
  return seen
}

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * A clock in milliseconds that only runs while `running()` is true: requestAnimationFrame, so it
 * stops in background tabs too.
 */
export function useClock(running: () => boolean) {
  const [time, setTime] = createSignal(0)
  createEffect(() => {
    if (!running()) return
    let frame = 0
    let last: number | undefined
    const tick = (now: number) => {
      if (last !== undefined) setTime((value) => value + Math.min(64, now - last!))
      last = now
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    onCleanup(() => cancelAnimationFrame(frame))
  })
  return [time, setTime] as const
}

export const ease = {
  out: (t: number) => 1 - Math.pow(1 - clamp(t), 3),
  outExpo: (t: number) => (clamp(t) === 1 ? 1 : 1 - Math.pow(2, -10 * clamp(t))),
  inOut: (t: number) => {
    const x = clamp(t)
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
  },
  // A small overshoot, like a part snapping into a jig.
  back: (t: number) => {
    const x = clamp(t)
    const c = 1.7
    return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2)
  },
}

export function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

/** Progress of `time` through [start, start + duration], 0–1. */
export const span = (time: number, start: number, duration: number) => clamp((time - start) / duration)
