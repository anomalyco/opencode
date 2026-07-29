import { RGBA } from "@opentui/core"
import { createEffect, createMemo, Index, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useConfig } from "../config"
import { FilePath, truncateFilePath } from "./file-path"

const DURATION = 600
const FEATHER = 8

// FilePath that cross-dissolves left to right when its value changes. The old
// path fades out while the new one fades in behind a soft sweep. The initial
// value renders immediately; only subsequent changes animate.
export function DissolveFilePath(props: {
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

  const cells = createMemo(() => {
    const previous = [...truncateFilePath(store.previous ?? "", props.maxWidth)]
    const next = [...truncateFilePath(store.text ?? "", props.maxWidth)]
    const width = Math.max(previous.length, next.length)
    const sweep = store.progress * (width + FEATHER)
    return Array.from({ length: width }, (_, index) => {
      const t = Math.min(1, Math.max(0, (sweep - index) / FEATHER))
      // Inside the sweep band the cell dips toward the background before the
      // new character surfaces, reading as a per-column cross-dissolve.
      const fade = Math.abs(t - 0.5) * 2
      return {
        char: (t < 0.5 ? previous[index] : next[index]) ?? " ",
        fg: mix(props.bg, props.fg, fade),
      }
    })
  })

  return (
    <Show when={store.text !== undefined}>
      <Show
        when={store.previous !== undefined}
        fallback={
          <FilePath value={store.text ?? ""} maxWidth={props.maxWidth} fg={props.fg} basenameFg={props.basenameFg} />
        }
      >
        <text wrapMode="none">
          <Index each={cells()}>{(cell) => <span style={{ fg: cell().fg }}>{cell().char}</span>}</Index>
        </text>
      </Show>
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
