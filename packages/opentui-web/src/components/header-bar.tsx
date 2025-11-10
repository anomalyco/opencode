import type { Component } from "solid-js"
import { createSignal, Show } from "solid-js"

interface HeaderBarProps {
  onNewSession?: () => void
  onShowHelp?: () => void
  class?: string
}

export const HeaderBar: Component<HeaderBarProps> = (props) => {
  const [showCommands, setShowCommands] = createSignal(false)

  const commands = [
    { key: "Ctrl+N", desc: "New Session" },
    { key: "Ctrl+L", desc: "Session List" },
    { key: "Ctrl+P", desc: "Command Palette" },
    { key: "Ctrl+/", desc: "Toggle Help" },
    { key: "Ctrl+S", desc: "Settings" },
    { key: "Esc", desc: "Cancel/Close" },
  ]

  return (
    <div
      class={props.class}
      style={{
        height: "48px",
        background: "#1e1e1e",
        "border-bottom": "1px solid #3e3e3e",
        display: "flex",
        "align-items": "center",
        "justify-content": "space-between",
        padding: "0 1rem",
        position: "relative",
      }}
    >
      {/* Logo/Brand */}
      <div style={{ display: "flex", "align-items": "center", gap: "1rem" }}>
        <div style={{ display: "flex", "align-items": "center", gap: "0.5rem" }}>
          <span style={{ "font-size": "1.25rem" }}>🚀</span>
          <span style={{ "font-weight": "bold", color: "#4ec9b0", "font-size": "1rem" }}>OpenTUI Web</span>
        </div>
      </div>

      {/* Commands */}
      <div style={{ display: "flex", "align-items": "center", gap: "1rem" }}>
        <button
          onClick={() => props.onNewSession?.()}
          style={{
            padding: "0.5rem 1rem",
            background: "#4ec9b0",
            border: "none",
            "border-radius": "4px",
            color: "#1e1e1e",
            cursor: "pointer",
            "font-family": "inherit",
            "font-size": "0.85rem",
            "font-weight": "600",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#5ed9c0"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "#4ec9b0"
          }}
        >
          + New Session
        </button>

        <button
          onClick={() => setShowCommands(!showCommands())}
          style={{
            padding: "0.5rem 0.75rem",
            background: "transparent",
            border: "1px solid #3e3e3e",
            "border-radius": "4px",
            color: "#858585",
            cursor: "pointer",
            "font-family": "inherit",
            "font-size": "0.85rem",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#4ec9b0"
            e.currentTarget.style.color = "#4ec9b0"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#3e3e3e"
            e.currentTarget.style.color = "#858585"
          }}
        >
          ⌘ Commands
        </button>
      </div>

      {/* Command Palette Dropdown */}
      <Show when={showCommands()}>
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: "1rem",
            "margin-top": "0.5rem",
            width: "300px",
            background: "#252525",
            border: "1px solid #3e3e3e",
            "border-radius": "4px",
            "box-shadow": "0 4px 12px rgba(0, 0, 0, 0.5)",
            "z-index": 1000,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "0.75rem 1rem", "border-bottom": "1px solid #3e3e3e" }}>
            <div style={{ "font-weight": "bold", color: "#d4d4d4", "font-size": "0.85rem" }}>Keyboard Shortcuts</div>
          </div>
          <div style={{ "max-height": "400px", "overflow-y": "auto" }}>
            {commands.map((cmd) => (
              <div
                style={{
                  display: "flex",
                  "justify-content": "space-between",
                  "align-items": "center",
                  padding: "0.75rem 1rem",
                  "border-bottom": "1px solid #2e2e2e",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#2e2e2e"
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent"
                }}
              >
                <span style={{ color: "#d4d4d4", "font-size": "0.85rem" }}>{cmd.desc}</span>
                <span
                  style={{
                    color: "#858585",
                    "font-size": "0.75rem",
                    background: "#1e1e1e",
                    padding: "0.25rem 0.5rem",
                    "border-radius": "2px",
                    border: "1px solid #3e3e3e",
                  }}
                >
                  {cmd.key}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Show>
    </div>
  )
}
