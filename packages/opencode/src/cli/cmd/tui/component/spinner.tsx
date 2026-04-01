import { Show, createSignal, onCleanup, onMount } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Spinner(props: { children?: JSX.Element; color?: RGBA }) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.textMuted
  const [idx, setIdx] = createSignal(0)

  onMount(() => {
    const id = setInterval(() => {
      setIdx((v) => (v + 1) % frames.length)
    }, 80)
    onCleanup(() => clearInterval(id))
  })

  return (
    <Show
      when={kv.get("animations_enabled", true)}
      fallback={
        <box flexDirection="row" gap={1}>
          <text fg={color()}>⋯</text>
          <Show when={props.children}>
            <text fg={color()}>{props.children}</text>
          </Show>
        </box>
      }
    >
      <box flexDirection="row" gap={1}>
        <text fg={color()}>{frames[idx()]}</text>
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}
