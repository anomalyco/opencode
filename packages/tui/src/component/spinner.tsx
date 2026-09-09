import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useConfig } from "../config"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { registerOpencodeSpinner } from "./register-spinner"
import { SPINNER_FRAMES } from "./spinner-frames"
import { ShimmerText } from "./shimmer-text"

export { SPINNER_FRAMES } from "./spinner-frames"

registerOpencodeSpinner()

export function Spinner(props: { children?: JSX.Element; color?: RGBA; shimmer?: RGBA }) {
  const theme = useTheme()
  const config = useConfig().data
  const color = () => props.color ?? theme.text.subdued
  const [frame, setFrame] = createSignal(0)
  createEffect(() => {
    if (!(config.animations ?? true) || !props.shimmer) return
    const timer = setInterval(() => setFrame((value) => (value + 1) % SPINNER_FRAMES.length), 80)
    onCleanup(() => clearInterval(timer))
  })
  return (
    <Show
      when={config.animations ?? true}
      fallback={<text fg={color()}>{props.children ? <>⋯ {props.children}</> : "⋯"}</text>}
    >
      <Show
        when={props.shimmer}
        fallback={
          <box flexDirection="row" gap={1}>
            <spinner frames={SPINNER_FRAMES} interval={80} color={color()} />
            <Show when={props.children}>
              <text fg={color()}>{props.children}</text>
            </Show>
          </box>
        }
      >
        {(shimmer) => (
          <ShimmerText fg={color()} shimmer={shimmer()}>
            {SPINNER_FRAMES[frame()]} {props.children}
          </ShimmerText>
        )}
      </Show>
    </Show>
  )
}
