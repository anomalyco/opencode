import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import open from "open"

export interface LinkProps {
  href: string
  children?: JSX.Element | string
  fg?: RGBA
}

/**
 * Link component that renders clickable hyperlinks.
 * Clicking anywhere on the link text opens the URL in the default browser.
 * A click-and-drag (text selection) is not treated as a click and does not open the browser.
 */
export function Link(props: LinkProps) {
  const displayText = props.children ?? props.href
  let mouseDownX = -1
  let mouseDownY = -1

  return (
    <text
      fg={props.fg}
      onMouseDown={(evt) => {
        mouseDownX = evt.x
        mouseDownY = evt.y
      }}
      onMouseUp={(evt) => {
        if (evt.x === mouseDownX && evt.y === mouseDownY) {
          open(props.href).catch(() => {})
        }
        mouseDownX = -1
        mouseDownY = -1
      }}
    >
      {displayText}
    </text>
  )
}
