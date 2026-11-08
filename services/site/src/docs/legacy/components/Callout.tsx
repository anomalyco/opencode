import type { JSX } from "solid-js"

export function Callout(props: { type?: "note" | "tip" | "warning"; title?: string; children?: JSX.Element }) {
  const type = props.type ?? "note"
  const title = props.title ?? (type === "tip" ? "Tip" : type === "warning" ? "Warning" : "Note")
  return (
    <aside class={`callout callout-${type}`} aria-label={title}>
      <strong>{title}</strong>
      <div>{props.children}</div>
    </aside>
  )
}
