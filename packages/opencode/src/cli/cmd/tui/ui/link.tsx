import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import open from "open"

export interface LinkProps {
  href: string
  children?: JSX.Element | string
  fg?: RGBA
}

/**
 * Link component that renders clickable hyperlinks.
 * Clicking anywhere on the link text opens the URL in the default browser.
 */
export function Link(props: LinkProps) {
  const displayText = props.children ?? props.href

  return (
    <text
      fg={props.fg}
      attributes={TextAttributes.UNDERLINE}
      onMouseUp={() => {
        open(props.href).catch(() => {})
      }}
    >
      {displayText}
    </text>
  )
}
