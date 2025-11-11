import type { Component } from "solid-js"

interface GridShimmerProps {
  col: number
  row: number
  text: string
  fg?: string
  bg?: string
}

export const GridShimmer: Component<GridShimmerProps> = (props) => {
  return (
    <div
      style={{
        position: "absolute",
        left: `${props.col}ch`,
        top: `${props.row * 1.2}em`,
        color: props.fg || "#ffffff",
        background: props.bg || "transparent",
        "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        "font-size": "16px",
        "line-height": "1.2",
        animation: "shimmer 2s infinite",
        "background-image": `linear-gradient(
          90deg,
          ${props.fg || "#ffffff"} 0%,
          ${props.fg || "#ffffff"}40 20%,
          ${props.fg || "#ffffff"}80 40%,
          ${props.fg || "#ffffff"}40 60%,
          ${props.fg || "#ffffff"} 100%
        )`,
        "background-size": "200% 100%",
        "background-clip": "text",
        "-webkit-background-clip": "text",
        "-webkit-text-fill-color": "transparent",
      }}
    >
      {props.text}
    </div>
  )
}
