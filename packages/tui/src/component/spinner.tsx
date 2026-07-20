import { Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useConfig } from "../config"
import type { JSX } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { registerOpencodeSpinner } from "./register-spinner"
import { SPINNER_FRAMES } from "./spinner-frames"

export { SPINNER_FRAMES } from "./spinner-frames"

registerOpencodeSpinner()

export function Spinner(props: { children?: JSX.Element; color?: RGBA }) {
  const { themeV2 } = useTheme()
  const config = useConfig().data
  const color = () => props.color ?? themeV2.text.subdued()
  return (
    <Show
      when={config.animations ?? true}
      fallback={<text fg={color()}>{props.children ? <>⋯ {props.children}</> : "⋯"}</text>}
    >
      <box flexDirection="row" gap={1}>
        <spinner frames={SPINNER_FRAMES} interval={80} color={color()} />
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}
