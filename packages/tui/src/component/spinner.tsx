import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import "opentui-spinner/solid"

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Spinner(props: { children?: JSX.Element; color?: RGBA; verbs?: string[] }) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.textMuted

  const [index, setIndex] = createSignal(0)

  createEffect(() => {
    if (!props.verbs?.length) return
    const id = setInterval(() => setIndex((i) => (i + 1) % props.verbs!.length), 3000)
    onCleanup(() => clearInterval(id))
  })

  const text = () => {
    if (props.verbs?.length) return props.verbs[index() % props.verbs.length] + "..."
    return props.children
  }

  return (
    <Show when={kv.get("animations_enabled", true)} fallback={<text fg={color()}>⋯ {text()}</text>}>
      <box flexDirection="row" gap={1}>
        <spinner frames={SPINNER_FRAMES} interval={80} color={color()} />
        <Show when={text()}>
          <text fg={color()}>{text()}</text>
        </Show>
      </box>
    </Show>
  )
}
