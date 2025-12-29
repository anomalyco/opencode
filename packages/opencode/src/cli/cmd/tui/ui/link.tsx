import type { JSX } from "solid-js"
import { TextAttributes, type RGBA } from "@opentui/core"
import open from "open"

export interface LinkProps {
  href: string
  children?: JSX.Element | string
  fg?: RGBA
}

/**
 * Link component that renders clickable hyperlinks.
 * Clicking anywhere on the link text opens the URL in the default browser.
 * Uses a full-width box wrapper to ensure the entire area is clickable even when text wraps.
 */
export function Link(props: LinkProps) {
  const displayText = props.children ?? props.href

  return (
    <box
      flexGrow={1}
      onMouseUp={() => {
        open(props.href).catch(() => {})
      }}
    >
      <text fg={props.fg} attributes={TextAttributes.UNDERLINE}>
        {displayText}
      </text>
    </box>
  )
}
