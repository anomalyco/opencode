import type { RGBA } from "@opentui/core"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { useConfig } from "../config"
import { tint } from "../theme/color"
import { createAnimatable, tween } from "./animation"
import { FilePath } from "./file-path"

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
  const fade = createAnimatable(
    { front: 1 },
    {
      enabled: () => config.animations ?? true,
      transition: tween({ duration: 0.3 }),
    },
  )
  const [text, setText] = createSignal(props.value)
  const [previous, setPrevious] = createSignal<string>()

  createEffect((current: string | undefined) => {
    const next = props.value
    if (next === undefined || next === current) return current
    setText(next)
    if (current === undefined) return next
    setPrevious(current)
    fade.jump({ front: 0 })
    fade.animate({ front: 1 })
    return next
  }, props.value)

  const display = createMemo(() => (previous() !== undefined && fade.value().front < 0.5 ? previous() : text()))
  const fg = createMemo(() => {
    if (previous() === undefined || fade.value().front >= 1) return props.fg
    return tint(props.bg, props.fg, Math.abs(fade.value().front * 2 - 1))
  })

  return (
    <Show when={display() !== undefined}>
      <FilePath
        value={display() ?? ""}
        maxWidth={props.maxWidth}
        fg={fg()}
        basenameFg={fade.value().front >= 1 ? props.basenameFg : undefined}
      />
    </Show>
  )
}
