import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import { openUrl } from "@opencode/util/open"

export interface LinkProps {
  href: string
  children?: JSX.Element | string
  fg?: RGBA
  bg?: RGBA
  width?: number | "auto" | `${number}%`
  wrapMode?: "word" | "none"
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
      bg={props.bg}
      width={props.width}
      wrapMode={props.wrapMode}
      onMouseUp={(event) => {
        // Modified clicks belong to the terminal's native OSC 8 link handler.
        // Opening them here as well launches the authorization page twice.
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.modifiers.ctrl ||
          event.modifiers.alt ||
          event.modifiers.shift
        )
          return
        event.stopPropagation()
        openUrl(props.href).catch(() => {})
      }}
    >
      <a href={props.href}>{displayText}</a>
    </text>
  )
}
