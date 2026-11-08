import type { JSX } from "solid-js"

// The site's callout (docs-variants.css): a tinted block with a coloured rule and label. MDX's
// "warning" is the stylesheet's "caution".
export function Callout(props: {
  type?: "note" | "tip" | "warning" | "caution" | "danger"
  title?: string
  children?: JSX.Element
}) {
  const type = props.type === "warning" ? "caution" : (props.type ?? "note")
  const title = props.title ?? { note: "Note", tip: "Tip", caution: "Warning", danger: "Danger" }[type]
  return (
    <aside data-component="callout" data-type={type} aria-label={title}>
      <strong>{title}</strong>
      <div>{props.children}</div>
    </aside>
  )
}
