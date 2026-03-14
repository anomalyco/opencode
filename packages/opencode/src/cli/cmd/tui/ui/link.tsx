import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { Selection } from "@tui/util/selection"
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
  const renderer = useRenderer()

  return (
    <text
      fg={props.fg}
      onMouseUp={() => {
        if (Selection.active(renderer)) return
        open(props.href).catch(() => {})
      }}
    >
      {displayText}
    </text>
  )
}
