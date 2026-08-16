import { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, on, onMount, Show } from "solid-js"
import { tint } from "../theme/color"
import { createAnimatable, tween } from "../ui/animation"

export type AssistantSummaryFlash = {
  trigger: number
  duration: number
  intensity: number
}

export function AssistantSummary(props: {
  agent: string
  model: string
  duration?: string
  interrupted?: boolean
  agentColor: RGBA
  subduedColor: RGBA
  flashColor: RGBA
  animations: boolean
  flash?: AssistantSummaryFlash
}) {
  const dimensions = useTerminalDimensions()
  const flash = createAnimatable(
    { level: 0 },
    {
      enabled: () => props.animations,
      transition: tween({ duration: props.flash?.duration ?? 0.32 }),
    },
  )
  const run = () => {
    if (!props.flash || !props.animations || props.flash.trigger === 0) return
    flash.jump({ level: props.flash.intensity })
    flash.animate({ level: 0 })
  }
  onMount(run)
  createEffect(on(() => props.flash?.trigger, run, { defer: true }))
  const color = (resting: RGBA) => tint(resting, props.flashColor, flash.value().level)

  return (
    <text>
      <span style={{ fg: color(props.agentColor) }}>{props.agent}</span>
      <Show when={dimensions().width >= 28}>
        <span style={{ fg: color(props.subduedColor) }}> · {props.model}</span>
      </Show>
      <Show when={props.duration && (dimensions().width < 28 || dimensions().width >= 36)}>
        <span style={{ fg: color(props.subduedColor) }}> · {props.duration}</span>
      </Show>
      <Show when={props.interrupted}>
        <span style={{ fg: color(props.subduedColor) }}> · interrupted</span>
      </Show>
    </text>
  )
}
