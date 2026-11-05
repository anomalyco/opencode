import { createMemo } from "solid-js"
import { pixelCells, pixelWidth } from "./pixel-font"

/** Text in the CRT's bitmap font, drawn as SVG cells so it stays crisp at any zoom. It is decorative: callers give the accessible name. */
export function PixelText(props: { text: string; class?: string }) {
  const path = createMemo(() =>
    pixelCells(props.text)
      .map(([x, y]) => `M${x} ${y}h1v1h-1z`)
      .join(""),
  )
  return (
    <svg
      class={props.class}
      data-component="pixel-text"
      viewBox={`0 0 ${pixelWidth(props.text)} 7`}
      aria-hidden="true"
      shape-rendering="crispEdges"
    >
      <path d={path()} />
    </svg>
  )
}
