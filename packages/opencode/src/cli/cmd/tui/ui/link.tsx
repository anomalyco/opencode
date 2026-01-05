import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import open from "open"

export interface LinkProps {
  href: string
  children?: JSX.Element | string
  fg?: RGBA
}

export function Link(props: LinkProps) {
  const displayText = props.children ?? props.href

  return (
    <text
      onMouseUp={() => {
        open(props.href).catch(() => {})
      }}
    >
      <a href={props.href} style={{ fg: props.fg }}>
        {displayText}
      </a>
    </text>
  )
}
