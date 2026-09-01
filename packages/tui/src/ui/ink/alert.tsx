import type { JSX } from "solid-js"
import { useTheme } from "../../context/theme"
import { Glyphs } from "../glyphs"

export type AlertVariant = "info" | "success" | "warning" | "error"

export function InkAlert(props: {
  variant?: AlertVariant
  title?: string
  children: JSX.Element
}) {
  const { theme } = useTheme()
  const variant = props.variant ?? "info"

  const color = () => {
    switch (variant) {
      case "success":
        return theme.success
      case "warning":
        return theme.warning
      case "error":
        return theme.error
      case "info":
      default:
        return theme.info
    }
  }

  const icon = () => {
    switch (variant) {
      case "success":
        return Glyphs.tick
      case "warning":
        return "⚠"
      case "error":
        return Glyphs.cross
      case "info":
      default:
        return "ℹ"
    }
  }

  return (
    <box
      border={["top", "bottom", "left", "right"]}
      borderColor={color()}
      backgroundColor={theme.backgroundPanel}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      marginTop={1}
      marginBottom={1}
    >
      <box flexDirection="row" alignItems="center" gap={1} paddingBottom={props.title ? 1 : 0}>
        <text fg={theme.background} bg={color()}>
          <b>{` ${icon()} ${variant.toUpperCase()} `}</b>
        </text>
        {props.title && (
          <text fg={theme.text}>
            <b>{props.title}</b>
          </text>
        )}
      </box>
      <text fg={theme.textMuted}>{props.children}</text>
    </box>
  )
}
