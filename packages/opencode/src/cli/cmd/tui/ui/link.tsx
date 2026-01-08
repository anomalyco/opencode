import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import path from "path"

export interface LinkProps {
  href: string
  children?: JSX.Element | string
  fg?: RGBA
}

export function Link(props: LinkProps) {
  const displayText = props.children ?? props.href

  return (
    <a href={props.href} style={{ fg: props.fg }}>
      {displayText}
    </a>
  )
}

export interface FilePathLinkProps {
  path: string
  children?: JSX.Element | string
  fg?: RGBA
}

export function FilePathLink(props: FilePathLinkProps) {
  const displayText = props.children ?? props.path
  const absolutePath = path.isAbsolute(props.path) ? props.path : path.resolve(process.cwd(), props.path)
  const fileUrl = `file://${absolutePath}`

  return (
    <a href={fileUrl} style={{ fg: props.fg }}>
      {displayText}
    </a>
  )
}
