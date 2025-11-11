import type { Component, JSX } from "solid-js"

interface GridTextProps {
  col: number
  row: number
  text: string
  fg?: string
  bg?: string
  bold?: boolean
  onClick?: () => void
  onMouseOver?: () => void
  onMouseOut?: () => void
  style?: JSX.CSSProperties
}

export const GridText: Component<GridTextProps> = (props) => {
  return (
    <span
      onClick={props.onClick}
      onMouseOver={props.onMouseOver}
      onMouseOut={props.onMouseOut}
      style={{
        position: "absolute",
        left: `${props.col}ch`,
        top: `${props.row * 1.2}em`,
        color: props.fg || "#d4d4d4",
        background: props.bg || "transparent",
        "font-weight": props.bold ? "bold" : "normal",
        "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        "font-size": "16px",
        "line-height": "1.2",
        cursor: props.onClick ? "pointer" : "default",
        "white-space": "pre",
        ...props.style,
      }}
    >
      {props.text}
    </span>
  )
}
