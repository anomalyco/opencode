import { useTheme } from "../context/theme"

export function Logo() {
  const { theme } = useTheme()
  return (
    <box alignItems="center" gap={1}>
      {/* Brand Header with Geometric Monogram Icon */}
      <box flexDirection="row" alignItems="center" gap={2}>
        {/* Monogram Icon Badge */}
        <box
          border={["top", "bottom", "left", "right"]}
          borderColor={theme.accent}
          backgroundColor={theme.backgroundElement}
          paddingLeft={1}
          paddingRight={1}
          flexDirection="row"
          alignItems="center"
        >
          <text fg={theme.accent}>
            <b>{"⚡ ZIQ"}</b>
          </text>
        </box>

        {/* Brand Text */}
        <box flexDirection="column" gap={0}>
          <box flexDirection="row" alignItems="center" gap={1}>
            <text fg={theme.primary}>
              <b>{"ZIQ"}</b>
            </text>
            <text fg={theme.text}>
              <b>{"-CODE"}</b>
            </text>
            <text fg={theme.textMuted}>{"·"}</text>
            <text fg={theme.textMuted}>{"Autonomous Engineering Agent"}</text>
          </box>
        </box>
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
