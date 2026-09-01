import type { RGBA } from "@opentui/core"
import type { JSX } from "solid-js"
import { useTheme } from "../context/theme"

export function Badge(props: {
  children: JSX.Element
  bg?: RGBA
  fg?: RGBA
}) {
  const { theme } = useTheme()
  return (
    <text fg={props.fg ?? theme.background} bg={props.bg ?? theme.primary}>
      <b>{` ${props.children} `}</b>
    </text>
  )
}
