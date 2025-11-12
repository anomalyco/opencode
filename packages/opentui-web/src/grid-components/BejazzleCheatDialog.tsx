import type { Component } from "solid-js"
import { For } from "solid-js"
import { useBejazzle, type BejazzleLevel } from "../context/bejazzle"

interface BejazzleCheatDialogProps {
  isOpen: boolean
  onClose: () => void
}

interface LevelInfo {
  level: BejazzleLevel
  name: string
  description: string
  threshold: number
  features: string[]
}

const levels: LevelInfo[] = [
  {
    level: 0,
    name: "Level 0: Basic",
    description: "Clean terminal aesthetic",
    threshold: 0,
    features: ["Sharp corners", "Flat colors", "Minimal styling"],
  },
  {
    level: 1,
    name: "Level 1: Rounded",
    description: "Soft edges appear",
    threshold: 3,
    features: ["Rounded corners (8px)", "Smooth transitions", "Enhanced readability"],
  },
  {
    level: 2,
    name: "Level 2: Gradients",
    description: "Color depth unlocked",
    threshold: 6,
    features: ["Gradient backgrounds", "Context chip enhancement", "Subtle color variations"],
  },
  {
    level: 3,
    name: "Level 3: Shadows",
    description: "Depth and dimension",
    threshold: 10,
    features: ["Drop shadows on panels", "Dialog elevation", "Serif fonts for headers"],
  },
  {
    level: 4,
    name: "Level 4: Animations",
    description: "Movement and life",
    threshold: 15,
    features: ["Hover glow effects", "Transform animations", "Fade-in transitions", "Larger fonts"],
  },
  {
    level: 5,
    name: "Level 5: MAXIMUM",
    description: "Full enhancement mode",
    threshold: 25,
    features: [
      "Custom scrollbars",
      "Shimmer loading states",
      "Enhanced focus rings",
      "Pulse animations",
      "Browser preview styling",
      "Mixed font families",
    ],
  },
]

export const BejazzleCheatDialog: Component<BejazzleCheatDialogProps> = (props) => {
  const {
    bejazzleMode,
    setBejazzleMode,
    bejazzleLevel,
    messageCount,
    incrementBejazzleLevel,
    showBejazzleNotification,
    applyPreset,
  } = useBejazzle()

  const handleClose = (e: MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains("dialog-overlay")) {
      props.onClose()
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onClose()
    }
  }

  const handleToggleBejazzle = () => {
    const newState = !bejazzleMode()
    setBejazzleMode(newState)
    // Apply full theme preset when enabling, minimal when disabling
    applyPreset(newState ? "full" : "minimal")
    showBejazzleNotification(newState ? "✨ Bejazzle Mode ENABLED!" : "❌ Bejazzle Mode Disabled")
  }

  const handleSetLevel = (targetLevel: BejazzleLevel) => {
    const current = bejazzleLevel()
    if (targetLevel > current) {
      // Increment up to target
      const steps = targetLevel - current
      for (let i = 0; i < steps; i++) {
        incrementBejazzleLevel()
      }
      showBejazzleNotification(`⚡ Jumped to ${levels[targetLevel]?.name}!`)
    }
  }

  if (!props.isOpen) return null

  return (
    <div
      class="dialog-overlay"
      style={{
        position: "fixed",
        top: "0",
        left: "0",
        right: "0",
        bottom: "0",
        background: "rgba(0, 0, 0, 0.85)",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        "z-index": "9999",
        "backdrop-filter": "blur(4px)",
      }}
      onClick={handleClose}
      onKeyDown={handleKeyDown}
    >
      <div
        role="dialog"
        style={{
          background: "#0a0a0a",
          border: "1px solid #2a2a2a",
          "border-radius": "8px",
          width: "90vw",
          "max-width": "900px",
          "max-height": "80vh",
          "overflow-y": "auto",
          padding: "1.5em",
          "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ "margin-bottom": "1.5em", "padding-bottom": "1em", "border-bottom": "1px solid #2a2a2a" }}>
          <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
            <h2 style={{ margin: "0", color: "#61afef", "font-size": "20px" }}>✨ Bejazzle Mode Settings</h2>
            <button
              style={{
                background: "transparent",
                border: "1px solid #3a3a3a",
                color: "#888888",
                padding: "0.5em 1em",
                cursor: "pointer",
                "border-radius": "4px",
                "font-family": "inherit",
              }}
              onClick={props.onClose}
            >
              Close (ESC)
            </button>
          </div>
        </div>

        {/* Status Section */}
        <div
          style={{
            background: "#1a1a1a",
            border: "1px solid #2a2a2a",
            "border-radius": "6px",
            padding: "1em",
            "margin-bottom": "1.5em",
          }}
        >
          <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
            <div>
              <div style={{ color: "#e5c07b", "font-weight": "bold", "margin-bottom": "0.5em" }}>
                Status: {bejazzleMode() ? "🟢 ENABLED" : "🔴 DISABLED"}
              </div>
              <div style={{ color: "#888888", "font-size": "14px" }}>
                Current Level: <span style={{ color: "#61afef" }}>{bejazzleLevel()}</span> • Messages:{" "}
                <span style={{ color: "#98c379" }}>{messageCount()}</span>
              </div>
            </div>
            <button
              style={{
                background: bejazzleMode() ? "#e06c75" : "#98c379",
                border: "none",
                color: "#000000",
                padding: "0.75em 1.5em",
                cursor: "pointer",
                "border-radius": "6px",
                "font-weight": "bold",
                "font-family": "inherit",
                transition: "all 0.2s ease",
              }}
              onClick={handleToggleBejazzle}
            >
              {bejazzleMode() ? "🚫 Disable" : "✨ Enable"} Bejazzle Mode
            </button>
          </div>
        </div>

        {/* Levels Section */}
        <div>
          <h3 style={{ color: "#c678dd", "margin-bottom": "1em" }}>Progressive Enhancement Levels</h3>
          <div style={{ display: "flex", "flex-direction": "column", gap: "1em" }}>
            <For each={levels}>
              {(levelInfo) => {
                const isUnlocked = () => bejazzleLevel() >= levelInfo.level
                const isCurrent = () => bejazzleLevel() === levelInfo.level
                const canUnlock = () => bejazzleMode() && levelInfo.level > bejazzleLevel()

                return (
                  <div
                    style={{
                      background: isCurrent() ? "#1a2a1a" : "#1a1a1a",
                      border: `1px solid ${isCurrent() ? "#98c379" : "#2a2a2a"}`,
                      "border-radius": "6px",
                      padding: "1em",
                      opacity: isUnlocked() || canUnlock() ? "1" : "0.5",
                      transition: "all 0.3s ease",
                    }}
                  >
                    <div style={{ display: "flex", "justify-content": "space-between", "align-items": "start" }}>
                      <div style={{ flex: "1" }}>
                        <div
                          style={{
                            color: isUnlocked() ? "#98c379" : "#888888",
                            "font-weight": "bold",
                            "margin-bottom": "0.5em",
                          }}
                        >
                          {isUnlocked() ? "✅" : "🔒"} {levelInfo.name}
                          {isCurrent() && (
                            <span style={{ color: "#e5c07b", "margin-left": "0.5em", "font-size": "12px" }}>
                              (ACTIVE)
                            </span>
                          )}
                        </div>
                        <div style={{ color: "#61afef", "font-size": "14px", "margin-bottom": "0.5em" }}>
                          {levelInfo.description}
                        </div>
                        <div style={{ color: "#888888", "font-size": "12px", "margin-bottom": "0.5em" }}>
                          Unlocks at: {levelInfo.threshold} messages
                        </div>
                        <ul style={{ margin: "0.5em 0 0 1.5em", padding: "0", "list-style": "none" }}>
                          <For each={levelInfo.features}>
                            {(feature) => (
                              <li style={{ color: "#888888", "font-size": "13px", "margin-bottom": "0.25em" }}>
                                • {feature}
                              </li>
                            )}
                          </For>
                        </ul>
                      </div>
                      <div>
                        {canUnlock() && (
                          <button
                            style={{
                              background: "#e5c07b",
                              border: "none",
                              color: "#000000",
                              padding: "0.5em 1em",
                              cursor: "pointer",
                              "border-radius": "4px",
                              "font-size": "12px",
                              "font-weight": "bold",
                              "font-family": "inherit",
                              "white-space": "nowrap",
                            }}
                            onClick={() => handleSetLevel(levelInfo.level)}
                          >
                            ⚡ Jump to Level
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </div>

        {/* Help Text */}
        <div
          style={{
            "margin-top": "1.5em",
            "padding-top": "1em",
            "border-top": "1px solid #2a2a2a",
            color: "#888888",
            "font-size": "13px",
          }}
        >
          <div style={{ "margin-bottom": "0.5em" }}>
            <strong style={{ color: "#61afef" }}>How it works:</strong>
          </div>
          <ul style={{ margin: "0", padding: "0 0 0 1.5em" }}>
            <li>Send messages to naturally progress through levels</li>
            <li>Or use "Jump to Level" buttons to unlock instantly (cheat mode!)</li>
            <li>Toggle Bejazzle Mode on/off anytime with Ctrl+X J</li>
            <li>Settings persist in localStorage</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
