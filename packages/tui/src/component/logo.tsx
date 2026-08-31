import { useTheme } from "../context/theme"

export function Logo() {
  const { theme } = useTheme()
  return (
    <box alignItems="center" gap={1}>
      <box flexDirection="row" alignItems="center" gap={1}>
        <text fg={theme.accent}>✦</text>
        <text fg={theme.text}>
          <b>Ziq-code</b>
        </text>
        <text fg={theme.textMuted}>· Autonomous Engineering Agent</text>
      </box>
      <box flexDirection="row" gap={2} paddingTop={0}>
        <text fg={theme.info}>
          <b>[⚡ DGX Qwen 27B · 131k Context]</b>
        </text>
        <text fg={theme.success}>
          <b>[🧠 Personalization: Active]</b>
        </text>
        <text fg={theme.warning}>
          <b>[🛡️ Quality Gate: V2]</b>
        </text>
      </box>
    </box>
  )
}
