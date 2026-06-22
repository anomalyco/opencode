import { Show } from "solid-js"
import { useTheme } from "../context/theme"
import type { TuiVoicePhase } from "../voice/runtime"

export function VoiceStatus(props: { phase: () => TuiVoicePhase; label: () => string }) {
  const { theme } = useTheme()

  return (
    <Show when={props.phase() !== "off"}>
      <box flexShrink={0} paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0}>
        <text style={{ fg: theme.info }}>{props.label()}</text>
      </box>
    </Show>
  )
}
