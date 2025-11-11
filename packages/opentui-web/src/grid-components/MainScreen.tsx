import type { Component } from "solid-js"
import { createSignal } from "solid-js"
import { GridPanel } from "./GridPanel"
import { GridText } from "./GridText"

interface MainScreenProps {
  onSubmit: (text: string) => void
}

export const MainScreen: Component<MainScreenProps> = (props) => {
  const [inputText, setInputText] = createSignal("")
  const [cursorVisible, setCursorVisible] = createSignal(true)

  // Cursor blink animation
  setInterval(() => {
    setCursorVisible((prev) => !prev)
  }, 530)

  const handleSubmit = () => {
    const text = inputText().trim()
    if (text) {
      props.onSubmit(text)
      setInputText("")
    }
  }

  const examplePrompts = [
    "Help me understand this codebase",
    "Add a new feature to my app",
    "Fix bugs in my tests",
    "Refactor this component",
  ]

  return (
    <div
      style={{
        position: "fixed",
        top: "0",
        left: "0",
        right: "0",
        bottom: "0",
        width: "100vw",
        height: "100vh",
        background: "#0a0a0a",
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        "justify-content": "center",
        "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        "font-size": "16px",
        "line-height": "1.2",
      }}
    >
      {/* Logo Container */}
      <div
        style={{
          "margin-bottom": "4em",
          display: "flex",
          "align-items": "center",
          "flex-direction": "column",
        }}
      >
        {/* Logo - inline SVG */}
        <svg
          width="240"
          height="41.5"
          viewBox="0 0 289 50"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ "margin-bottom": "1em" }}
        >
          <path d="M264.5 0H288.5V8.5H272.5V16.5H288.5V25H272.5V33H288.5V41.5H264.5V0Z" fill="white" />
          <path d="M248.5 0H224.5V41.5H248.5V33H232.5V8.5H248.5V0Z" fill="white" />
          <path d="M256.5 8.5H248.5V33H256.5V8.5Z" fill="white" />
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M184.5 0H216.5V41.5H184.5V0ZM208.5 8.5H192.5V33H208.5V8.5Z"
            fill="white"
          />
          <path d="M144.5 8.5H136.5V41.5H144.5V8.5Z" fill="white" />
          <path d="M136.5 0H112.5V41.5H120.5V8.5H136.5V0Z" fill="white" />
          <path d="M80.5 0H104.5V8.5H88.5V16.5H104.5V25H88.5V33H104.5V41.5H80.5V0Z" fill="white" />
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M40.5 0H72.5V41.5H48.5V49.5H40.5V0ZM64.5 8.5H48.5V33H64.5V8.5Z"
            fill="white"
          />
          <path
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M0.5 0H32.5V41.5955H0.5V0ZM24.5 8.5H8.5V33H24.5V8.5Z"
            fill="white"
          />
          <path d="M152.5 0H176.5V8.5H160.5V33H176.5V41.5H152.5V0Z" fill="white" />
        </svg>

        {/* Tagline */}
        <div
          style={{
            color: "#6a6a6a",
            "font-size": "14px",
            "text-align": "center",
          }}
        >
          the best coding agent on the planet
        </div>
      </div>

      {/* Input Container */}
      <div
        style={{
          width: "min(700px, 80vw)",
          "margin-bottom": "3em",
        }}
      >
        {/* Main Input Box */}
        <div
          style={{
            background: "#1a1a1a",
            padding: "1.2em 1.5em",
            "border-radius": "4px",
            border: "1px solid #2a2a2a",
            position: "relative",
            "min-height": "3.6em",
            display: "flex",
            "align-items": "center",
          }}
        >
          {/* Accent line on left */}
          <div
            style={{
              position: "absolute",
              left: "0",
              top: "0",
              bottom: "0",
              width: "3px",
              background: "#ff9800",
            }}
          />

          {/* Prompt symbol */}
          <span style={{ color: "#ff9800", "font-weight": "bold", "margin-right": "1ch" }}>{">"}</span>

          {/* Input text */}
          <span style={{ color: "#ffffff", flex: "1" }}>{inputText() || ""}</span>

          {/* Placeholder when empty */}
          {!inputText() && (
            <span
              style={{
                position: "absolute",
                left: "calc(1.5em + 2ch)",
                color: "#6a6a6a",
                "pointer-events": "none",
              }}
            >
              Ask opencode anything...
            </span>
          )}

          {/* Cursor */}
          {cursorVisible() && <span style={{ color: "#ff9800", "margin-left": "2px" }}>█</span>}

          {/* Hidden textarea for keyboard capture */}
          <textarea
            value={inputText()}
            onInput={(e) => setInputText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            autofocus
            style={{
              position: "absolute",
              left: "0",
              top: "0",
              width: "100%",
              height: "100%",
              background: "transparent",
              color: "transparent",
              "caret-color": "transparent",
              border: "none",
              outline: "none",
              resize: "none",
              "font-family": "inherit",
              "font-size": "inherit",
              "line-height": "inherit",
              padding: "1.2em 1.5em",
            }}
          />
        </div>

        {/* Hint text below input */}
        <div
          style={{
            "margin-top": "0.6em",
            color: "#6a6a6a",
            "font-size": "14px",
            "text-align": "center",
          }}
        >
          <span style={{ color: "#ffffff", "font-weight": "bold" }}>enter</span> to send
          {" · "}
          <span style={{ color: "#ffffff", "font-weight": "bold" }}>shift+enter</span> for new line
        </div>
      </div>

      {/* Example Prompts */}
      <div
        style={{
          width: "min(700px, 80vw)",
        }}
      >
        <div
          style={{
            color: "#858585",
            "font-size": "14px",
            "margin-bottom": "1em",
          }}
        >
          Try these:
        </div>

        <div
          style={{
            display: "grid",
            "grid-template-columns": "repeat(2, 1fr)",
            gap: "0.8em",
          }}
        >
          {examplePrompts.map((prompt) => (
            <div
              onClick={() => {
                setInputText(prompt)
              }}
              style={{
                background: "#1a1a1a",
                padding: "0.8em 1em",
                "border-radius": "4px",
                border: "1px solid #2a2a2a",
                color: "#858585",
                cursor: "pointer",
                transition: "all 0.15s ease",
                "font-size": "14px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#ff9800"
                e.currentTarget.style.color = "#ffffff"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#2a2a2a"
                e.currentTarget.style.color = "#858585"
              }}
            >
              {prompt}
            </div>
          ))}
        </div>
      </div>

      {/* Footer hint */}
      <div
        style={{
          position: "fixed",
          bottom: "2em",
          color: "#6a6a6a",
          "font-size": "14px",
        }}
      >
        <span style={{ color: "#ffffff", "font-weight": "bold" }}>ctrl+p</span> for commands
      </div>
    </div>
  )
}
