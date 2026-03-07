import { createEffect, createMemo, createSignal, onCleanup, type ValidComponent } from "solid-js"
import { Dynamic } from "solid-js/web"

export const TextShimmer = <T extends ValidComponent = "span">(props: {
  text: string
  class?: string
  as?: T
  active?: boolean
  offset?: number
}) => {
  const active = createMemo(() => props.active ?? true)
  const offset = createMemo(() => props.offset ?? 0)
  const [run, setRun] = createSignal(active())
  const swap = 220
  let timer: ReturnType<typeof setTimeout> | undefined

  createEffect(() => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }

    if (active()) {
      setRun(true)
      return
    }

    timer = setTimeout(() => {
      timer = undefined
      setRun(false)
    }, swap)
  })

  onCleanup(() => {
    if (!timer) return
    clearTimeout(timer)
  })

  const shimmerSize = createMemo(() => {
    const len = Math.max(props.text.length, 1)
    return Math.max(300, Math.round(200 + 1400 / len))
  })

  // duration = len × (size - 1) / velocity → uniform perceived sweep speed
  const VELOCITY = 0.01375 // ch per ms, ~10% faster than original 0.0125 baseline
  const shimmerDuration = createMemo(() => {
    const len = Math.max(props.text.length, 1)
    const s = shimmerSize() / 100
    return Math.max(1000, Math.min(2500, Math.round((len * (s - 1)) / VELOCITY)))
  })

  return (
    <Dynamic
      component={props.as ?? "span"}
      data-component="text-shimmer"
      data-active={active() ? "true" : "false"}
      class={props.class}
      aria-label={props.text}
      style={{
        "--text-shimmer-swap": `${swap}ms`,
        "--text-shimmer-index": `${offset()}`,
        "--text-shimmer-size": `${shimmerSize()}%`,
        "--text-shimmer-duration": `${shimmerDuration()}ms`,
      }}
    >
      <span data-slot="text-shimmer-char">
        <span data-slot="text-shimmer-char-base" aria-hidden="true">
          {props.text}
        </span>
        <span data-slot="text-shimmer-char-shimmer" data-run={run() ? "true" : "false"} aria-hidden="true">
          {props.text}
        </span>
      </span>
    </Dynamic>
  )
}
