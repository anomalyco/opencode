import type { JSX } from "solid-js"
import { base } from "../../config"

export function Card(props: { title: string; href: string; children?: JSX.Element }) {
  const href = props.href.startsWith("/") ? `${base.slice(0, -1)}${props.href}` : props.href
  return (
    <a class="docs-card" href={href}>
      <strong>{props.title}</strong>
      <div>{props.children}</div>
    </a>
  )
}
