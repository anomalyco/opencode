import { RGBA } from "@opentui/core"
import { createEffect, createMemo, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useConfig } from "../config"
import { FilePath } from "./file-path"

const DURATION = 300

// FilePath that crossfades when its value changes: the old path fades to the
// background, the text swaps at the midpoint, and the new path fades back in.
// The initial value renders immediately; only subsequent changes animate.
export function FadeFilePath(props: {
  value: string | undefined
  maxWidth: number
  fg: RGBA
  bg: RGBA
  basenameFg?: RGBA
}) {
  const config = useConfig().data
  const [store, setStore] = createStore({
    text: props.value,
    previous: undefined as string | undefined,
    progress: 1,
  })

  createEffect(
    on(
      () => props.value,
      (text) => {
        // The source can flicker to undefined while a new location syncs;
        // retain the last path so the change animates as one transition.
        if (text === undefined || text === store.text) return
        if (store.text === undefined || !(config.animations ?? true)) {
          setStore({ text, previous: undefined, progress: 1 })
          return
        }
        setStore({ text, previous: store.text, progress: 0 })
        const started = performance.now()
        const timer = setInterval(() => {
          const progress = Math.min(1, (performance.now() - started) / DURATION)
          setStore("progress", progress)
          if (progress >= 1) {
            clearInterval(timer)
            setStore("previous", undefined)
          }
        }, 33)
        onCleanup(() => clearInterval(timer))
      },
      { defer: true },
    ),
  )

  const display = createMemo(() => (store.previous !== undefined && store.progress < 0.5 ? store.previous : store.text))
  const fg = createMemo(() => {
    if (store.previous === undefined) return props.fg
    const t = store.progress < 0.5 ? 1 - store.progress * 2 : store.progress * 2 - 1
    return mix(props.bg, props.fg, t)
  })

  return (
    <Show when={display() !== undefined}>
      <FilePath
        value={display() ?? ""}
        maxWidth={props.maxWidth}
        fg={fg()}
        basenameFg={store.previous === undefined ? props.basenameFg : undefined}
      />
    </Show>
  )
}

function mix(from: RGBA, to: RGBA, t: number) {
  return RGBA.fromValues(
    from.r + (to.r - from.r) * t,
    from.g + (to.g - from.g) * t,
    from.b + (to.b - from.b) * t,
    from.a + (to.a - from.a) * t,
  )
}
