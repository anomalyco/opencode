import type { Component } from "solid-js"
import { createSignal } from "solid-js"

interface GridDividerProps {
  col: number // Current column position
  minCol: number // Minimum column
  maxCol: number // Maximum column
  onDrag: (col: number) => void
  alwaysVisible?: boolean // Always show the divider (default: false)
}

export const GridDivider: Component<GridDividerProps> = (props) => {
  const [isDragging, setIsDragging] = createSignal(false)
  const [isHovered, setIsHovered] = createSignal(false)

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

  const backgroundColor = () => {
    if (isDragging()) return "#4ec9b0"
    if (isHovered()) return "rgba(106, 106, 106, 0.3)"
    return props.alwaysVisible ? "#2a2a2a" : "transparent"
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: "fixed",
        left: `${props.col}ch`,
        top: "0",
        bottom: "0",
        height: "100vh",
        width: "1ch",
        background: backgroundColor(),
        cursor: "col-resize",
        "z-index": "1000",
        "user-select": "none",
        transition: "background 0.15s ease",
      }}
    >
      {/* Visual indicator */}
      <div
        style={{
          position: "absolute",
          left: "0",
          top: "50%",
          width: "1ch",
          height: "3em",
          transform: "translateY(-50%)",
          background: "#4ec9b0",
          opacity: isDragging() || isHovered() ? "0.8" : "0",
          transition: "opacity 0.2s ease",
          "pointer-events": "none",
        }}
      />
    </div>
  )
}
