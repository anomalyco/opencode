import type { Component } from "solid-js"
import { GridText } from "./GridText"

interface SubagentNavProps {
  parentSessionId: string
  currentSessionId: string
  siblings: Array<{ id: string; title: string }>
  onNavigate: (sessionId: string) => void
  width: number
}

export const SubagentNav: Component<SubagentNavProps> = (props) => {
  const currentIndex = () => props.siblings.findIndex((s) => s.id === props.currentSessionId)
  const hasPrevious = () => currentIndex() > 0
  const hasNext = () => currentIndex() < props.siblings.length - 1

  const handlePrevious = () => {
    if (hasPrevious()) {
      const prevSibling = props.siblings[currentIndex() - 1]
      if (prevSibling) {
        props.onNavigate(prevSibling.id)
      }
    }
  }

  const handleNext = () => {
    if (hasNext()) {
      const nextSibling = props.siblings[currentIndex() + 1]
      if (nextSibling) {
        props.onNavigate(nextSibling.id)
      }
    }
  }

  const handleBackToParent = () => {
    props.onNavigate(props.parentSessionId)
  }

  return (
    <div
      style={{
        position: "absolute",
        top: "0",
        left: "0",
        right: "0",
        height: "2.4em",
        background: "#0a0a0a",
        "border-bottom": "1px solid #1a1a1a",
        display: "flex",
        "align-items": "center",
        "justify-content": "space-between",
        padding: "0 2ch",
        "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        "font-size": "16px",
        "line-height": "1.2",
        "z-index": "100",
      }}
    >
      {/* Left: Back to parent */}
      <span
        onClick={handleBackToParent}
        style={{
          color: "#ff9800",
          "font-weight": "bold",
          cursor: "pointer",
          "user-select": "none",
        }}
      >
        ← Back to parent
      </span>

      {/* Center: Current viewing state */}
      <span style={{ color: "#ffffff" }}>Viewing subagent session</span>

      {/* Right: Previous/Next navigation */}
      <div style={{ display: "flex", gap: "2ch", "align-items": "center" }}>
        {/* Previous */}
        <span
          onClick={handlePrevious}
          style={{
            color: hasPrevious() ? "#ff9800" : "#6a6a6a",
            cursor: hasPrevious() ? "pointer" : "not-allowed",
            "user-select": "none",
          }}
        >
          ← Previous <span style={{ color: "#6a6a6a", "font-size": "14px" }}>ctrl+left</span>
        </span>

        {/* Next */}
        <span
          onClick={handleNext}
          style={{
            color: hasNext() ? "#ff9800" : "#6a6a6a",
            cursor: hasNext() ? "pointer" : "not-allowed",
            "user-select": "none",
          }}
        >
          Next → <span style={{ color: "#6a6a6a", "font-size": "14px" }}>ctrl+right</span>
        </span>
      </div>
    </div>
  )
}
