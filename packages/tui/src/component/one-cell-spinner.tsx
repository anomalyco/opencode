import { parseColor, RGBA, type ColorInput } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { oneCellFrame, type OneCellMotion } from "../ui/one-cell-motion"
import { registerOpencodeSpinner } from "./register-spinner"

registerOpencodeSpinner()

export function OneCellSpinner(props: {
  animation: OneCellMotion
  color: ColorInput
  animations?: boolean
  speed?: number
  paused?: boolean
  glow?: boolean
  age?: number
  still?: string
}) {
  const renderer = useRenderer()
  const [elapsed, setElapsed] = createSignal(0)
  const sequenced = () => !!props.animation.intro || !!props.animation.once || !!props.animation.pace
  const frame = createMemo(() => oneCellFrame(props.animation, elapsed()))
  const complete = createMemo(() => frame().complete)
  const base = createMemo(() => parseColor(props.color))
  const color = createMemo(() => {
    if (props.glow === false) return base()
    if (sequenced()) {
      const color = RGBA.clone(base())
      color.a *= frame().level
      return color
    }
    const palette = props.animation.levels?.map((level) => {
      const color = RGBA.clone(base())
      color.a *= level
      return color
    })
    return palette ? (frame: number) => palette[frame]! : base()
  })

  createEffect(() => {
    props.animation
    props.animations
    setElapsed(props.age ?? 0)
  })
  createEffect(() => {
    if (!sequenced() || props.animations === false || props.paused || complete()) return
    let previous = performance.now()
    // Leave idle gaps: mini awaits renderer.idle() to flush and admit prompts.
    const timer = setInterval(
      () => {
        const now = performance.now()
        setElapsed((value) => value + (now - previous) * (props.speed ?? 1))
        previous = now
      },
      Math.max(
        1000 / 60,
        Math.min(40, props.animation.interval / (props.speed ?? 1) / (props.animation.pace?.initial ?? 1)),
      ),
    )
    onCleanup(() => {
      clearInterval(timer)
      renderer.requestRender()
    })
  })

  return (
    <box width={1} height={1} flexShrink={0}>
      <Show when={props.animations !== false} fallback={<text fg={base()}>{props.still ?? "\u25aa"}</text>}>
        <spinner
          frames={sequenced() ? [frame().glyph] : props.animation.frames}
          interval={props.animation.interval / (props.speed ?? 1)}
          autoplay={!props.paused && !sequenced()}
          color={color()}
        />
      </Show>
    </box>
  )
}
