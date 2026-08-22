import type { JSX } from "solid-js"
import { getLinkId, type OptimizedBuffer, type RGBA } from "@opentui/core"
import open from "open"

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
        event.stopPropagation()
        open(props.href).catch(() => {})
      }}
    >
      <a href={props.href}>{displayText}</a>
    </text>
  )
}

export function linkAt(buffer: OptimizedBuffer, x: number, y: number) {
  if (x < 0 || x >= buffer.width || y < 0 || y >= buffer.height) return
  const id = getLinkId(buffer.buffers.attributes[y * buffer.width + x] ?? 0)
  if (!id) return
  const lib = buffer.lib as typeof buffer.lib & { linkGetUrl(id: number): string }
  return lib.linkGetUrl(id) || undefined
}
