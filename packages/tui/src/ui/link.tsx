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
 * `isDragging`, and each rendered cell stores its full URL, so a click on any row of a wrapped link resolves the whole
 * link. Modified clicks are left to the terminal's own hyperlink handling.
 *
 * A click is a gesture that starts and ends on the same cell. Requiring a fresh "cell" selection was too strict: a
 * re-click inside opentui's double-click window arrives as a "word" selection, and a pointer that crossed a cell
 * boundary between press and release keeps a moved focus even when it settles back on the link. Both still start and
 * end on one cell, so they open the link. Gestures that end elsewhere stay selections, so drag selection (for example
 * copy on select) keeps working, and triple clicks ("line") remain selection gestures.
 */
export function clickedLink(renderer: CliRenderer, event: MouseEvent) {
  if (!event.isDragging || event.modifiers.ctrl || event.modifiers.alt || event.modifiers.shift) return
  const selection = renderer.getSelection()
  if (!selection || selection.behavior === "line") return
  const anchor = selection.anchor
  if (anchor.x !== selection.focus.x || anchor.y !== selection.focus.y) return
  return renderer.getLinkAt(event.x, event.y) ?? undefined
}
