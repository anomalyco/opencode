import type { JSX } from "solid-js"
import { latestDocs } from "../config"

export function Card(props: { title: string; href: string; children?: JSX.Element }) {
  const href = props.href.startsWith("/") ? `${latestDocs.base.slice(0, -1)}${props.href}` : props.href
  return (
    <a data-component="docs-card" href={href}>
      <strong>{props.title}</strong>
      <div>{props.children}</div>
    </a>
  )
}
