import { Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useConfig } from "../config"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { registerOpencodeSpinner } from "./register-spinner"

registerOpencodeSpinner()

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Spinner(props: { children?: JSX.Element; color?: RGBA; trailing?: JSX.Element }) {
  const { theme } = useTheme()
  const config = useConfig().data
  const color = () => props.color ?? theme.textMuted
  return (
    <box flexDirection="row" gap={1}>
      <Show when={config.animations ?? true} fallback={<text fg={color()}>⋯</text>}>
        <spinner frames={SPINNER_FRAMES} interval={80} color={color()} />
      </Show>
      <Show when={props.children}>
        <Show when={props.trailing} fallback={<text fg={color()}>{props.children}</text>}>
          {(trailing) => (
            <box flexDirection="row" flexWrap="wrap" columnGap={1} flexGrow={1}>
              <text fg={color()}>{props.children}</text>
              {trailing()}
            </box>
          )}
        </Show>
      </Show>
    </box>
  )
}
