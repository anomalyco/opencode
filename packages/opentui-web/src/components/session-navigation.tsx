import type { Component } from "solid-js"

interface SessionNavigationProps {
  sessionTitle?: string
  hasParent?: boolean
  hasPrevious?: boolean
  hasNext?: boolean
  onBack?: () => void
  onPrevious?: () => void
  onNext?: () => void
}

export const SessionNavigation: Component<SessionNavigationProps> = (props) => {
  return (
    <div
      style={{
        height: "44px",
        background: "#1e1e1e",
        "border-bottom": "1px solid #3e3e3e",
        display: "flex",
        "align-items": "center",
        "justify-content": "space-between",
        padding: "0 1rem",
        "font-family": '"Berkeley Mono", monospace',
      }}
    >
      {/* Left: Back and Previous */}
      <div style={{ display: "flex", "align-items": "center", gap: "1rem" }}>
        <button
          onClick={props.onBack}
          disabled={!props.hasParent}
          style={{
            background: "transparent",
            border: "none",
            color: props.hasParent ? "#d4d4d4" : "#3e3e3e",
            cursor: props.hasParent ? "pointer" : "not-allowed",
            "font-family": '"Berkeley Mono", monospace',
            "font-size": "0.8rem",
            display: "flex",
            "align-items": "center",
            gap: "0.5rem",
            padding: "0.5rem",
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => {
            if (props.hasParent) {
              e.currentTarget.style.color = "#4ec9b0"
            }
          }}
          onMouseLeave={(e) => {
            if (props.hasParent) {
              e.currentTarget.style.color = "#d4d4d4"
            }
          }}
        >
          ← Back to parent
        </button>

        <button
          onClick={props.onPrevious}
          disabled={!props.hasPrevious}
          style={{
            background: "transparent",
            border: "none",
            color: props.hasPrevious ? "#d4d4d4" : "#3e3e3e",
            cursor: props.hasPrevious ? "pointer" : "not-allowed",
            "font-family": '"Berkeley Mono", monospace',
            "font-size": "0.8rem",
            display: "flex",
            "align-items": "center",
            gap: "0.5rem",
            padding: "0.5rem",
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => {
            if (props.hasPrevious) {
              e.currentTarget.style.color = "#4ec9b0"
            }
          }}
          onMouseLeave={(e) => {
            if (props.hasPrevious) {
              e.currentTarget.style.color = "#d4d4d4"
            }
          }}
        >
          ← Previous <span style={{ color: "#858585", "font-size": "0.75rem" }}>ctrl+left</span>
        </button>
      </div>

      {/* Center: Session info */}
      <div style={{ color: "#858585", "font-size": "0.8rem" }}>{props.sessionTitle || "Viewing session"}</div>

      {/* Right: Next */}
      <button
        onClick={props.onNext}
        disabled={!props.hasNext}
        style={{
          background: "transparent",
          border: "none",
          color: props.hasNext ? "#d4d4d4" : "#3e3e3e",
          cursor: props.hasNext ? "pointer" : "not-allowed",
          "font-family": "inherit",
          "font-size": "0.85rem",
          display: "flex",
          "align-items": "center",
          gap: "0.5rem",
          padding: "0.5rem",
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => {
          if (props.hasNext) {
            e.currentTarget.style.color = "#4ec9b0"
          }
        }}
        onMouseLeave={(e) => {
          if (props.hasNext) {
            e.currentTarget.style.color = "#d4d4d4"
          }
        }}
      >
        <span style={{ color: "#858585", "font-size": "0.75rem" }}>ctrl+right</span> Next →
      </button>
    </div>
  )
}
