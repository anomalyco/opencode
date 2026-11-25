import { createEffect, createMemo, createSignal, on, onCleanup, untrack, type ValidComponent } from "solid-js"
import { Dynamic } from "solid-js/web"
import { prefersReducedMotion } from "../../motion/reduced"
import {
  createTextShimmerState,
  DISPOSED_TEXT_SHIMMER_EVENT,
  selectTextShimmerActive,
  selectTextShimmerRunning,
  syncTextShimmerEvent,
  TEXT_SHIMMER_SWAP_MS,
  transitionTextShimmer,
  type TextShimmerEvent,
} from "./machine"
import "./text-shimmer.css"

export const TextShimmer = <T extends ValidComponent = "span">(props: {
  text: string
  class?: string
  as?: T
  active?: boolean
  offset?: number
}) => {
  const text = createMemo(() => props.text ?? "")
  const active = createMemo(() => props.active ?? true)
  const [state, setState] = createSignal(createTextShimmerState(untrack(active)))
  let timer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: TextShimmerEvent) => {
    const previous = untrack(state)
    const next = transitionTextShimmer(previous, event)

    if (next === previous) return
    clearTimeout(timer)
    timer = undefined

    if (next.status === "disposed") return
    setState(next)

    if (next.status !== "fading") return
    const attempt = next.attempt
    timer = setTimeout(() => {
      timer = undefined
      dispatch({ type: "settled", attempt })
    }, TEXT_SHIMMER_SWAP_MS)
  }

  // The first state comes from the initial prop, so a mount dispatches nothing and arms no timer.
  createEffect(on(active, (value) => dispatch(syncTextShimmerEvent(value, prefersReducedMotion())), { defer: true }))

  onCleanup(() => dispatch(DISPOSED_TEXT_SHIMMER_EVENT))

  return (
    <Dynamic
      component={props.as ?? "span"}
      data-component="text-shimmer"
      data-active={selectTextShimmerActive(state()) ? "true" : "false"}
      class={props.class}
      aria-label={text()}
      style={{
        "--text-shimmer-swap": `${TEXT_SHIMMER_SWAP_MS}ms`,
        "--text-shimmer-index": `${props.offset ?? 0}`,
      }}
    >
      <span data-slot="text-shimmer-char">
        <span data-slot="text-shimmer-char-base" aria-hidden="true">
          {text()}
        </span>
        <span
          data-slot="text-shimmer-char-shimmer"
          data-run={selectTextShimmerRunning(state()) ? "true" : "false"}
          aria-hidden="true"
        >
          {text()}
          <span data-slot="text-shimmer-sweep">
            <span data-slot="text-shimmer-sweep-text">{text()}</span>
          </span>
        </span>
      </span>
    </Dynamic>
  )
}
