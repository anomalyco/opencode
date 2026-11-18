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
 * `isDragging`, and a `"cell"` selection still anchored in its start cell means the pointer never left it; other
 * releases, such as the end of a drag that started outside text, are not clicks. Each rendered cell stores its full
 * URL, so a click on any row of a wrapped link resolves the whole link. Modified clicks are left to the terminal's own
 * hyperlink handling.
 */
export function clickedLink(renderer: CliRenderer, event: MouseEvent) {
  if (!plainClick(renderer, event)) return
  return renderer.getLinkAt(event.x, event.y) ?? undefined
}

export function plainClick(renderer: CliRenderer, event: MouseEvent) {
  if (!event.isDragging || event.modifiers.ctrl || event.modifiers.alt || event.modifiers.shift) return false
  const selection = renderer.getSelection()
  // opentui clears `isStart` on every motion report, including a zero-distance one, and real pointing devices always
  // report some motion. A release is still a click when the selection never left its start cell.
  return (
    selection?.behavior === "cell" &&
    selection.anchor.x === selection.focus.x &&
    selection.anchor.y === selection.focus.y
  )
}
