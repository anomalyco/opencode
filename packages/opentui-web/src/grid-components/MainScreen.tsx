import type { Component } from "solid-js"
import { createSignal, onCleanup, onMount } from "solid-js"
import { GridPanel } from "./GridPanel"
import { GridText } from "./GridText"
import { CommandMenu } from "./CommandMenu"
import { StyledDialog } from "./Dialog"
import { SessionPicker, type Session } from "./SessionPicker"

interface MainScreenProps {
  onSubmit: (text: string) => void
  sessions?: Array<{ id: string; title: string; timestamp?: number }>
  onSelectSession?: (id: string) => void
  onNewSession?: () => void
  onToggleLeftSidebar?: () => void
  onToggleRightSidebar?: () => void
  onToggleBothSidebars?: () => void
  onSwitchModel?: () => void
  onSwitchAgent?: () => void
}

export const MainScreen: Component<MainScreenProps> = (props) => {
  console.log("[MainScreen] RENDERING MAIN SCREEN")
  const [inputText, setInputText] = createSignal("")
  const [cursorVisible, setCursorVisible] = createSignal(true)
  const [cursorPosition, setCursorPosition] = createSignal(0)
  const [commandMenuOpen, setCommandMenuOpen] = createSignal(false)
  const [sessionPickerOpen, setSessionPickerOpen] = createSignal(false)
  let textareaRef: HTMLTextAreaElement | undefined

  // Cursor blink animation
  const blinkInterval = setInterval(() => {
    setCursorVisible((prev) => !prev)
  }, 530)

  // Global keyboard handler for Ctrl+P
  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    if (e.key === "p" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      setCommandMenuOpen(true)
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleGlobalKeyDown)
  })

  onCleanup(() => {
    clearInterval(blinkInterval)
    window.removeEventListener("keydown", handleGlobalKeyDown)
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
          "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        }}
      >
        {/* ASCII Logo */}
        <pre
          style={{
            "font-size": "16px",
            "line-height": "1.0",
            margin: "0",
            "text-align": "left",
          }}
        >
          <span style={{ color: "#6a6a6a" }}>{`█▀▀▀ █▀▀█ █▀▀█ █▀▀▀ `}</span>
          <span style={{ color: "#ffffff", "font-weight": "bold" }}>{`█▀▀▀ █  █ █▀▀█ █▀▀▀`}</span>
          {`\n`}
          <span style={{ color: "#6a6a6a" }}>{`█░░░ █░░█ █░░█ █▀▀▀ `}</span>
          <span style={{ color: "#ffffff", "font-weight": "bold" }}>{`▀▀▀█ █  █ █▄▄▀ █▀▀▀`}</span>
          {`\n`}
          <span style={{ color: "#6a6a6a" }}>{`▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ `}</span>
          <span style={{ color: "#ffffff", "font-weight": "bold" }}>{`▀▀▀▀ ▀▀▀▀ ▀  ▀ ▀   `}</span>
        </pre>

        {/* Version */}
        <div
          style={{
            color: "#6a6a6a",
            "font-size": "14px",
            "text-align": "right",
            width: "100%",
            "margin-top": "0.5em",
          }}
        >
          v0.0.0-dev
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
              background: "#d19a66",
            }}
          />

          {/* Prompt symbol */}
          <span style={{ color: "#d19a66", "font-weight": "bold", "margin-right": "1ch" }}>{">"}</span>

          {/* Input container with placeholder and text */}
          <span style={{ color: "#ffffff", flex: "1", display: "flex", position: "relative" }}>
            {/* Placeholder behind cursor when empty */}
            {!inputText() && (
              <span
                style={{
                  position: "absolute",
                  left: "0",
                  color: "#6a6a6a",
                  "pointer-events": "none",
                }}
              >
                Ask codesurf anything...
              </span>
            )}

            {/* Input text with cursor */}
            <span style={{ position: "relative", "z-index": "1" }}>
              {inputText().slice(0, cursorPosition())}
              <span style={{ color: cursorVisible() ? "#d19a66" : "transparent" }}>█</span>
              {inputText().slice(cursorPosition())}
            </span>
          </span>

          {/* Hidden textarea for keyboard capture */}
          <textarea
            ref={textareaRef}
            value={inputText()}
            onInput={(e) => {
              setInputText(e.currentTarget.value)
              setCursorPosition(e.currentTarget.selectionStart)
            }}
            onClick={(e) => setCursorPosition(e.currentTarget.selectionStart)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            onKeyUp={(e) => setCursorPosition(e.currentTarget.selectionStart)}
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
                border: "none",
                color: "#858585",
                cursor: "pointer",
                transition: "all 0.15s ease",
                "font-size": "14px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#2a2a2a"
                e.currentTarget.style.color = "#ffffff"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#1a1a1a"
                e.currentTarget.style.color = "#858585"
              }}
            >
              {prompt}
            </div>
          ))}
        </div>
      </div>

      {/* Footer hint - clickable */}
      <div
        onClick={() => setCommandMenuOpen(true)}
        style={{
          position: "fixed",
          bottom: "2em",
          color: "#6a6a6a",
          "font-size": "14px",
          cursor: "pointer",
          transition: "color 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "#ffffff"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "#6a6a6a"
        }}
      >
        <span style={{ color: "#ffffff", "font-weight": "bold" }}>ctrl+p</span> for commands
      </div>

      {/* Command Menu */}
      <CommandMenu
        isOpen={commandMenuOpen()}
        onClose={() => setCommandMenuOpen(false)}
        hideViewCommands={true}
        sessions={props.sessions}
        onSelectSession={(sessionId) => {
          setCommandMenuOpen(false)
          props.onSelectSession?.(sessionId)
        }}
        onNewSession={() => {
          setCommandMenuOpen(false)
          props.onNewSession?.()
        }}
        onSwitchSession={() => {
          setCommandMenuOpen(false)
          setSessionPickerOpen(true)
        }}
        onSwitchModel={() => {
          setCommandMenuOpen(false)
          props.onSwitchModel?.()
        }}
        onSwitchAgent={() => {
          setCommandMenuOpen(false)
          props.onSwitchAgent?.()
        }}
        onToggleLeftSidebar={() => {}}
        onToggleRightSidebar={() => {}}
        onToggleBothSidebars={() => {}}
      />

      {/* Session Picker */}
      <SessionPicker
        isOpen={sessionPickerOpen()}
        sessions={(props.sessions || []).map((s) => ({
          id: s.id,
          title: s.title,
          timestamp: s.timestamp || Date.now(),
        }))}
        onSelect={(sessionId) => {
          setSessionPickerOpen(false)
          props.onSelectSession?.(sessionId)
        }}
        onClose={() => setSessionPickerOpen(false)}
      />
    </div>
  )
}
