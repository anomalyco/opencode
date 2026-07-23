import { createEffect, createMemo, createSignal, onCleanup, type ValidComponent } from "solid-js"
import { Dynamic } from "solid-js/web"
import "./text-shimmer-v2.css"

export const TextShimmerV2 = <T extends ValidComponent = "span">(props: {
  text: string
  class?: string
  as?: T
  active?: boolean
  offset?: number
}) => {
  const text = createMemo(() => props.text ?? "")
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

  return (
    <Dynamic
      component={props.as ?? "span"}
      data-component="text-shimmer-v2"
      data-active={active() ? "true" : "false"}
      class={props.class}
      aria-label={text()}
      style={{
        "--_swap": `${swap}ms`,
        "--_index": `${offset()}`,
      }}
    >
      <span data-slot="text-shimmer-v2-char">
        <span data-slot="text-shimmer-v2-base" aria-hidden="true">
          {text()}
        </span>
        <span data-slot="text-shimmer-v2-shimmer" data-run={run() ? "true" : "false"} aria-hidden="true">
          {text()}
        </span>
      </span>
    </Dynamic>
  )
}
