import type { JSX } from "solid-js"
import { useTheme } from "../../context/theme"
import { Glyphs } from "../glyphs"
import { Spinner } from "../../component/spinner"

export type StatusVariant = "info" | "success" | "warning" | "error" | "pending"

export function InkStatusMessage(props: {
  variant?: StatusVariant
  children: JSX.Element
}) {
  const { theme } = useTheme()
  const variant = props.variant ?? "info"

  return (
    <box flexDirection="row" alignItems="center" gap={1}>
      {variant === "pending" && <Spinner color={theme.accent} />}
      {variant === "success" && (
        <text fg={theme.success}>
          <b>{` ${Glyphs.tick} `}</b>
        </text>
      )}
      {variant === "error" && (
        <text fg={theme.error}>
          <b>{` ${Glyphs.cross} `}</b>
        </text>
      )}
      {variant === "warning" && (
        <text fg={theme.warning}>
          <b>{" ⚠ "}</b>
        </text>
      )}
      {variant === "info" && (
        <text fg={theme.info}>
          <b>{" ℹ "}</b>
        </text>
      )}
      <text fg={theme.text}>{props.children}</text>
    </box>
  )
}
