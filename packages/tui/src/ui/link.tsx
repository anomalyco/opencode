import type { JSX } from "solid-js"
import type { CliRenderer, MouseEvent, RGBA } from "@opentui/core"
import { openUrl } from "@opencode/util/open"
import { isPlainClick } from "./click"

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
      <a href={props.href}>{displayText}</a>
    </text>
  )
}

/**
 * Returns the hyperlink under a plain left click (see isPlainClick). Each rendered cell stores
 * its full URL, so a click on any row of a wrapped link resolves the whole link.
 */
export function clickedLink(renderer: CliRenderer, event: MouseEvent) {
  if (!isPlainClick(renderer, event)) return
  return renderer.getLinkAt(event.x, event.y) ?? undefined
}
