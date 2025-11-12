import type { Component } from "solid-js"
import { createSignal } from "solid-js"

interface GridDividerProps {
  col: number // Current column position
  minCol: number // Minimum column
  maxCol: number // Maximum column
  onDrag: (col: number) => void
  alwaysVisible?: boolean // Always show the divider (default: false)
  style?: any // Additional styles
  class?: string // CSS class for targeting
}

export const GridDivider: Component<GridDividerProps> = (props) => {
  const [isDragging, setIsDragging] = createSignal(false)
  const [isHovering, setIsHovering] = createSignal(false)

  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)

    const handleMouseMove = (moveEvent: MouseEvent) => {
      // Convert pixel position to character column
      const charWidth = 9.6 // Berkeley Mono character width
      const newCol = Math.round(moveEvent.clientX / charWidth)

      // Snap to grid and clamp to min/max
      const snappedCol = Math.max(props.minCol, Math.min(props.maxCol, newCol))
      props.onDrag(snappedCol)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }

  return (
    <div
      class={props.class}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      style={{
        position: "fixed",
        left: `${props.col}ch`,
        top: "0",
        bottom: props.alwaysVisible ? "calc(7.2em + 6ch)" : "0",
        height: props.alwaysVisible ? "auto" : "100vh",
        width: "1ch",
        background: isHovering() || isDragging() ? "#333333" : "transparent",
        cursor: "col-resize",
        "z-index": "1000",
        "user-select": "none",
      }}
    />
  )
}
