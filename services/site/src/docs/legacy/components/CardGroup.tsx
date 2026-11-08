import type { JSX } from "solid-js"

export function CardGroup(props: { cols?: number; children?: JSX.Element }) {
  return (
    <div class="docs-card-group" style={`--card-columns: ${props.cols ?? 2}`}>
      {props.children}
    </div>
  )
}
