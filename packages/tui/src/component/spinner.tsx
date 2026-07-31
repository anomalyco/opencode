import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { registerOpencodeSpinner } from "./register-spinner"

registerOpencodeSpinner()

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

const VERB_INTERVAL_MS = 3000

function verbLabel(verb: string) {
  return /[.!?…]$/.test(verb) ? verb : `${verb}...`
}

export function Spinner(props: {
  children?: JSX.Element
  color?: RGBA
  /** Verbs to cycle through as the spinner label while the model is thinking. */
  verbs?: string[]
  /** Stable suffix kept after the cycling verb, e.g. a reasoning step title. */
  suffix?: string
}) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.textMuted
  const [index, setIndex] = createSignal(0)

  createEffect(() => {
    if (!kv.get("animations_enabled", true) || !props.verbs?.length) return
    const count = props.verbs.length
    const id = setInterval(() => setIndex((i) => (i + 1) % count), VERB_INTERVAL_MS)
    onCleanup(() => clearInterval(id))
  })

  const label = () => {
    if (!props.verbs?.length) return props.children
    const verb = props.verbs[index() % props.verbs.length]
    const suffix = props.suffix ? " " + props.suffix : ""
    return verbLabel(verb) + suffix
  }

  return (
    <Show when={kv.get("animations_enabled", true)} fallback={<text fg={color()}>⋯ {label()}</text>}>
      <box flexDirection="row" gap={1}>
        <spinner frames={SPINNER_FRAMES} interval={80} color={color()} />
        <Show when={label()}>
          <text fg={color()}>{label()}</text>
        </Show>
      </box>
    </Show>
  )
}
