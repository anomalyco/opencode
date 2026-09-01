import { useTheme } from "../context/theme"

export function Logo() {
  const { theme } = useTheme()
  return (
    <box alignItems="center" gap={1}>
      {/* Brand Header with Sleek Icon Badge */}
      <box flexDirection="row" alignItems="center" gap={1}>
        <box
          border={["top", "bottom", "left", "right"]}
          borderColor={theme.accent}
          backgroundColor={theme.backgroundElement}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={theme.accent}>
            <b>{"⚡"}</b>
          </text>
        </box>
        <text fg={theme.text}>
          <b>
            <span style={{ fg: theme.primary }}>ZIQ</span>
            <span style={{ fg: theme.text }}>-CODE</span>
          </b>
        </text>
      </box>

      {/* Feature Badges */}
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
