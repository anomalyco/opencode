import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import { openUrl } from "@opencode-ai/core/open"

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
      onMouseUp={() => {
        openUrl(props.href).catch(() => {})
      }}
    >
      {displayText}
    </text>
  )
}
