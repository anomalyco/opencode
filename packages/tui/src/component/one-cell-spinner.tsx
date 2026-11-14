import { parseColor, RGBA, type ColorInput } from "@opentui/core"
import { onAnimationTick, useRenderer } from "@opentui/solid"
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { oneCellFrame, type OneCellMotion } from "../ui/one-cell-motion"
import "./spinner-renderable"

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
  // Ticks on the shared clock leave idle gaps: mini awaits renderer.idle() to flush and admit prompts. The Solid
  // hook is not bound to a node's draw: hidden with visible={false} it keeps ticking. Mount under <Show>.
  const step = createMemo(() => {
    if (!sequenced() || props.animations === false || props.paused || complete()) return
    return Math.max(
      1000 / 60,
      Math.min(40, props.animation.interval / (props.speed ?? 1) / (props.animation.pace?.initial ?? 1)),
    )
  })
  onAnimationTick(
    () => {
      const ms = step()
      return ms === undefined ? undefined : 1000 / ms
    },
    (_deltaTime, ticks) => setElapsed((value) => value + ticks * step()! * (props.speed ?? 1)),
  )
  createEffect(() => {
    if (step() !== undefined) onCleanup(() => renderer.requestRender())
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
