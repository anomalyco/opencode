import { useTheme } from "../context/theme"

export function Logo() {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" alignItems="center" gap={1}>
      <text fg={theme.primary}>✦</text>
      <text fg={theme.text}>
        <b>Ziq-code</b>
      </text>
    </box>
  )
}
