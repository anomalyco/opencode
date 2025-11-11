import type { Component } from "solid-js"
import { createSignal, onCleanup } from "solid-js"
import { GridPanel } from "./GridPanel"
import { GridText } from "./GridText"

interface MainScreenProps {
  onSubmit: (text: string) => void
}

export const MainScreen: Component<MainScreenProps> = (props) => {
  const [inputText, setInputText] = createSignal("")
  const [cursorVisible, setCursorVisible] = createSignal(true)

  // Cursor blink animation
  const blinkInterval = setInterval(() => {
    setCursorVisible((prev) => !prev)
  }, 530)

  onCleanup(() => {
    clearInterval(blinkInterval)
  })

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
        {/* Logo - text */}
        <div
          style={{
            "font-size": "48px",
            "font-weight": "bold",
            color: "#ffffff",
            "letter-spacing": "-0.02em",
            "margin-bottom": "0.5em",
          }}
        >
          codesurf
        </div>

        {/* Tagline */}
        <div
          style={{
            color: "#6a6a6a",
            "font-size": "14px",
            "text-align": "center",
          }}
        >
          ride the wave of code
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

          {/* Input text with cursor */}
          <span style={{ color: "#ffffff", flex: "1", display: "flex" }}>
            {inputText()}
            {cursorVisible() && <span style={{ color: "#ff9800" }}>█</span>}
          </span>

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
              Ask codesurf anything...
            </span>
          )}

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
