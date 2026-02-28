import { createEffect, createMemo, createSignal, onCleanup, type ValidComponent } from "solid-js"
import { Dynamic } from "solid-js/web"

export const TextShimmer = <T extends ValidComponent = "span">(props: {
  text: string
  class?: string
  as?: T
  active?: boolean
  offset?: number
  stepMs?: number
  durationMs?: number
  swapMs?: number
  spread?: number
  size?: number
  angle?: number
  base?: string
  peak?: string
}) => {
  const active = createMemo(() => props.active ?? true)
  const offset = createMemo(() => props.offset ?? 0)
  const swap = createMemo(() => props.swapMs ?? 220)
  const spread = createMemo(() => props.spread ?? 5.2)
  const size = createMemo(() => props.size ?? 360)
  const angle = createMemo(() => props.angle ?? 90)
  const [run, setRun] = createSignal(active())
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
    }, swap())
  })

  onCleanup(() => {
    if (!timer) return
    clearTimeout(timer)
  })

  return (
    <Dynamic
      component={props.as ?? "span"}
      data-component="text-shimmer"
      data-active={active() ? "true" : "false"}
      class={props.class}
      aria-label={props.text}
      style={{
        "--text-shimmer-step": `${props.stepMs ?? 45}ms`,
        "--text-shimmer-duration": `${props.durationMs ?? 1200}ms`,
        "--text-shimmer-swap": `${swap()}ms`,
        "--text-shimmer-index": `${offset()}`,
        "--text-shimmer-spread": `${spread()}ch`,
        "--text-shimmer-size": `${size()}%`,
        "--text-shimmer-angle": `${angle()}deg`,
        "--text-shimmer-base-color": props.base ?? "var(--text-weak)",
        "--text-shimmer-peak-color": props.peak ?? "var(--text-strong)",
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
