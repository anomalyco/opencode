import type { JSX } from "solid-js"
import type { CliRenderer, MouseEvent, RGBA } from "@opentui/core"
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
      onMouseUp={() => {
        openUrl(props.href).catch(() => {})
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
 * link resolves the whole link. Modified clicks are left to the terminal's own hyperlink handling.
 */
export function clickedLink(renderer: CliRenderer, event: MouseEvent) {
  if (!event.isDragging || event.modifiers.ctrl || event.modifiers.alt || event.modifiers.shift) return
  const selection = renderer.getSelection()
  if (!selection?.isStart || selection.behavior !== "cell") return
  return renderer.getLinkAt(event.x, event.y) ?? undefined
}
