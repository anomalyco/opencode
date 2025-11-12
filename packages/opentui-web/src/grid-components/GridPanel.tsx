import type { Component, JSX } from "solid-js"

interface GridPanelProps {
  col: number // Starting column
  row: number // Starting row
  width: number // Width in characters
  height?: number | "100%" // Height in rows or percentage
  bg?: string // Background color
  scrollable?: boolean // Enable scrolling (default: false for backward compatibility)
  leftMargin?: string // Additional left margin (e.g., "10px")
  style?: JSX.CSSProperties // Additional custom styles
  children?: JSX.Element
  class?: string // CSS class for targeting
}

export const GridPanel: Component<GridPanelProps> = (props) => {
  // For 100% height, use 100% (parent flex container handles layout)
  const height = props.height === "100%" ? "100%" : props.height ? `${props.height * 1.2}em` : "100%"
  const overflow = props.scrollable ? "auto" : "hidden"

  return (
    <div
      class={props.class}
      style={{
        position: "absolute",
        left: `calc(${props.col}ch + ${props.leftMargin || "0px"})`,
        top: `${props.row * 1.2}em`,
        width: `${props.width}ch`,
        height: height,
        background: props.bg || "#1a1a1a",
        overflow: overflow,
        "overflow-x": "hidden", // Never scroll horizontally
        "z-index": "1", // Below dividers (z-index: 1000)
        // GPU acceleration for smooth resizing
        transform: "translateZ(0)",
        "will-change": "transform",
        "-webkit-backface-visibility": "hidden",
        // Children position relative to this panel
        "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        "font-size": "16px",
        "line-height": "1.2",
        // Custom scrollbar styling
        ...(props.scrollable && {
          "scrollbar-width": "thin",
          "scrollbar-color": "#3a3a3a #1a1a1a",
        }),
        // Merge custom styles (allows overriding overflow, etc.)
        ...props.style,
      }}
    >
      {props.children}
    </div>
  )
}
