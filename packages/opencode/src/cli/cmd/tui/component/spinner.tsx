import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import type { ColorGenerator } from "../ui/spinner"

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

interface FrameSpinnerProps {
  frames: string[]
  interval?: number
  color?: RGBA | ColorGenerator
}

function isColorGenerator(color: FrameSpinnerProps["color"]): color is ColorGenerator {
  return typeof color === "function"
}

export function FrameSpinner(props: FrameSpinnerProps) {
  const [frameIndex, setFrameIndex] = createSignal(0)
  const allFrames = createMemo(() => (props.frames.length > 0 ? props.frames : [""]))
  const frame = createMemo(() => allFrames()[frameIndex() % allFrames().length] ?? "")

  onMount(() => {
    if (allFrames().length <= 1) return

    const timer = setInterval(() => {
      setFrameIndex((current) => (current + 1) % allFrames().length)
    }, props.interval ?? 80)

    onCleanup(() => {
      clearInterval(timer)
    })
  })

  return (
    <Show when={isColorGenerator(props.color)} fallback={<text fg={props.color as RGBA | undefined}>{frame()}</text>}>
      <box flexDirection="row" gap={0}>
        <For each={frame().split("")}>
          {(char, index) => (
            <text fg={(props.color as ColorGenerator)(frameIndex(), index(), allFrames().length, frame().length)}>{char}</text>
          )}
        </For>
      </box>
    </Show>
  )
}

export function Spinner(props: { children?: JSX.Element; color?: RGBA }) {
  const { theme } = useTheme()
  const kv = useKV()
  const color = () => props.color ?? theme.textMuted
  return (
    <Show when={kv.get("animations_enabled", true)} fallback={<text fg={color()}>⋯ {props.children}</text>}>
      <box flexDirection="row" gap={1}>
        <FrameSpinner frames={frames} interval={80} color={color()} />
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}
