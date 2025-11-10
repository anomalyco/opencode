import type { Component } from "solid-js"

interface GridInputProps {
  col: number // Grid column position
  row: number // Grid row position
  width: number // Width in characters
  value: string
  onInput: (value: string) => void
  placeholder?: string
}

export const GridInput: Component<GridInputProps> = (props) => {
  return (
    <input
      value={props.value}
      onInput={(e) => props.onInput(e.currentTarget.value)}
      placeholder={props.placeholder}
      style={{
        position: "absolute",
        left: `${props.col}ch`,
        top: `${props.row * 1.2}em`,
        width: `${props.width}ch`,
        height: "1.2em",
        "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        "font-size": "16px",
        "line-height": "1.2",
        background: "#0a0a0a",
        color: "#ffffff",
        border: "none",
        outline: "none",
        padding: "0",
        margin: "0",
      }}
    />
  )
}
