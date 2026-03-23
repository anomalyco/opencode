import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import path from "path"
import { revealScheme } from "@tui/util/reveal"

export interface LinkProps {
  href: string
  children?: JSX.Element | string
  fg?: RGBA
}

export function Link(props: LinkProps) {
  const display = props.children ?? props.href

  return (
    <a href={props.href} style={{ fg: props.fg }}>
      {display}
    </a>
  )
}

export interface FilePathLinkProps {
  path: string
  children?: JSX.Element | string
  fg?: RGBA
}

export function FilePathLink(props: FilePathLinkProps) {
  const display = props.children ?? props.path
  const absolute = path.isAbsolute(props.path) ? props.path : path.resolve(process.cwd(), props.path)

  return (
    <a href={revealScheme(absolute)} style={{ fg: props.fg }}>
      {display}
    </a>
  )
}
