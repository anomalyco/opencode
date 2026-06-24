import { useTheme } from "../context/theme"
import type { TuiVoicePhase } from "../voice/runtime"

export function VoiceStatus(props: { phase: () => TuiVoicePhase; label: () => string }) {
  const { theme } = useTheme()
  const enabled = () => props.phase() !== "off"

  return (
    <box flexShrink={0} paddingBottom={1}>
      <text style={{ fg: enabled() ? theme.info : theme.textMuted }}>
        {enabled() ? props.label() : "Voice · off (/voice to enable)"}
      </text>
    </box>
  )
}
