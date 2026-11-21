import type { JSX } from "solid-js"
import type { CliRenderer, MouseEvent, RGBA } from "@opentui/core"
import { openHref } from "@opencode/util/open"

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
 * Clicking anywhere on the link text opens http(s) URLs in the browser, or local file paths with the OS handler.
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
        openHref(props.href).catch(() => {})
      }}
    >
      <a href={props.href}>{displayText}</a>
    </text>
  )
}

/**
 * Returns the hyperlink under a plain left click. opentui marks the release that ends a selection gesture with
 * `isDragging`, and a fresh "cell" selection means the pointer never moved; other releases, such as the end of a drag
 * that started outside text, are not clicks. Each rendered cell stores its full URL, so a click on any row of a wrapped
 * link resolves the whole link. Modified clicks (including Cmd/meta when the terminal reports it) are left to the
 * terminal's own hyperlink handling.
 */
export function clickedLink(renderer: CliRenderer, event: MouseEvent) {
  if (!plainClick(renderer, event)) return
  return renderer.getLinkAt(event.x, event.y) ?? undefined
}

export function plainClick(renderer: CliRenderer, event: MouseEvent) {
  if (!event.isDragging || Object.values(event.modifiers).some(Boolean)) return false
  const selection = renderer.getSelection()
  return selection?.isStart === true && selection.behavior === "cell"
}
