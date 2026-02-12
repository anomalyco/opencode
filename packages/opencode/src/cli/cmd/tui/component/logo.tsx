import { TextAttributes, RGBA } from "@opentui/core"
import { useTheme } from "@tui/context/theme"

// Cerebras orange: RGB 240, 90, 40
const CEREBRAS_ORANGE = RGBA.fromInts(240, 90, 40)

// "C" letter (first letter, colored orange)
const C_LINE1 = `█▀▀▀`
const C_LINE2 = `█░░░`
const C_LINE3 = `▀▀▀▀`

// Rest of "EREBRAS"
const REST_LINE1 = ` █▀▀▀ █▀▀█ █▀▀▀ █▀▀▄ █▀▀█ █▀▀█ █▀▀▀`
const REST_LINE2 = ` █▀▀▀ █▀▀▄ █▀▀▀ █▀▀▄ █▀▀▄ █▀▀█ ▀▀▀█`
const REST_LINE3 = ` ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀  ▀  ▀ ▀  ▀ ▀▀▀▀`

// "Code CLI" in block characters
const CODE_LINE1 = `█▀▀▀  █▀▀█  █▀▀▄  █▀▀▀   █▀▀▀  █░░  ▀█▀`
const CODE_LINE2 = `█░░░  █░░█  █░░█  █▀▀▀   █░░░  █░░  ░█░`
const CODE_LINE3 = `▀▀▀▀  ▀▀▀▀  ▀▀▀   ▀▀▀▀   ▀▀▀▀  ▀▀▀  ▀▀▀`

export function Logo() {
  const { theme } = useTheme()
  return (
    <box>
      <text attributes={TextAttributes.BOLD}>
        <span style={{ fg: CEREBRAS_ORANGE }}>{C_LINE1}</span>
        <span style={{ fg: theme.text }}>{REST_LINE1}</span>
      </text>
      <text attributes={TextAttributes.BOLD}>
        <span style={{ fg: CEREBRAS_ORANGE }}>{C_LINE2}</span>
        <span style={{ fg: theme.text }}>{REST_LINE2}</span>
      </text>
      <text attributes={TextAttributes.BOLD}>
        <span style={{ fg: CEREBRAS_ORANGE }}>{C_LINE3}</span>
        <span style={{ fg: theme.text }}>{REST_LINE3}</span>
      </text>
      <text fg={theme.textMuted}>{CODE_LINE1}</text>
      <text fg={theme.textMuted}>{CODE_LINE2}</text>
      <text fg={theme.textMuted}>{CODE_LINE3}</text>
    </box>
  )
}
