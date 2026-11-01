import { createEffect, createSignal, onCleanup, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useConfig } from "../config"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import "./spinner-renderable"
import { SPINNER_FRAMES } from "./spinner-frames"
import { ShimmerText } from "./shimmer-text"

export { SPINNER_FRAMES } from "./spinner-frames"

export function Spinner(props: { children?: JSX.Element; color?: RGBA; shimmer?: RGBA; truncate?: boolean }) {
  const theme = useTheme()
  const config = useConfig().data
  const color = () => props.color ?? theme.text.muted
  const [frame, setFrame] = createSignal(0)
  createEffect(() => {
    if (!(config.animations ?? true) || !props.shimmer) return
    const timer = setInterval(() => setFrame((value) => (value + 1) % SPINNER_FRAMES.length), 80)
    onCleanup(() => clearInterval(timer))
  })
  // A bare spinner beside a long sibling shrinks to a fractional width that rounds to 0, so the
  // glyph paints on top of the row gap. Only a labeled spinner may shrink (to wrap its text).
  return (
    <Show
      when={config.animations ?? true}
      fallback={
        <text fg={color()} wrapMode={props.truncate ? "none" : undefined} truncate={props.truncate}>
          {props.children ? <>⋯ {props.children}</> : "⋯"}
        </text>
      }
    >
      <Show
        when={props.shimmer}
        fallback={
          <box flexDirection="row" gap={1} flexShrink={props.children ? 1 : 0} minWidth={props.truncate ? 0 : undefined}>
            <box flexShrink={0}>
              <spinner frames={SPINNER_FRAMES} interval={80} color={color()} />
            </box>
            <Show when={props.children}>
              <text
                fg={color()}
                flexShrink={props.truncate ? 1 : undefined}
                minWidth={props.truncate ? 0 : undefined}
                wrapMode={props.truncate ? "none" : undefined}
                truncate={props.truncate}
              >
                {props.children}
              </text>
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
