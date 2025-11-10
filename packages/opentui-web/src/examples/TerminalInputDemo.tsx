import type { Component } from "solid-js"
import { createSignal } from "solid-js"
import { TerminalInput } from "../grid-components"

/**
 * Demo component showcasing the TerminalInput component
 *
 * Features demonstrated:
 * - Orange > prompt character
 * - Blinking orange cursor
 * - White text input
 * - Tab to show options
 * - Esc to hide options
 * - Enter to submit
 * - Shift+Enter for newline
 */
export const TerminalInputDemo: Component = () => {
  const [inputValue, setInputValue] = createSignal("")
  const [submittedMessages, setSubmittedMessages] = createSignal<string[]>([])
  const [showAttachments, setShowAttachments] = createSignal(true)

  const handleSubmit = (text: string) => {
    setSubmittedMessages((prev) => [...prev, text])
    setInputValue("")
  }

  const sampleAttachments = [{ type: "image" as const, label: "Image 1" }]

  return (
    <div
      style={{
        position: "fixed",
        top: "0",
        left: "0",
        width: "100vw",
        height: "100vh",
        background: "#0a0a0a",
        "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        "font-size": "16px",
        "line-height": "1.2",
        display: "flex",
        "flex-direction": "column",
      }}
    >
      {/* Messages area */}
      <div
        style={{
          flex: "1",
          padding: "2em",
          "overflow-y": "auto",
          color: "#d4d4d4",
        }}
      >
        <h1 style={{ color: "#e5c07b", "margin-bottom": "1em" }}>TerminalInput Demo</h1>

        <div style={{ "margin-bottom": "2em", color: "#6a6a6a" }}>
          <p>Try the following:</p>
          <ul style={{ "padding-left": "2ch", "margin-top": "0.5em" }}>
            <li>Type some text - see the blinking cursor</li>
            <li>
              Toggle attachments:{" "}
              <button
                onClick={() => setShowAttachments(!showAttachments())}
                style={{
                  "margin-left": "1ch",
                  background: "#2a2a2a",
                  color: "#e5c07b",
                  border: "1px solid #4a4a4a",
                  padding: "0 1ch",
                  cursor: "pointer",
                }}
              >
                {showAttachments() ? "Hide" : "Show"} [Image 1]
              </button>
            </li>
            <li>
              Press <span style={{ color: "#ffffff", "font-weight": "bold" }}>Tab</span> to show options
            </li>
            <li>
              Press <span style={{ color: "#ffffff", "font-weight": "bold" }}>Esc</span> to hide options
            </li>
            <li>
              Press <span style={{ color: "#ffffff", "font-weight": "bold" }}>Enter</span> to submit message
            </li>
            <li>
              Press <span style={{ color: "#ffffff", "font-weight": "bold" }}>Shift+Enter</span> for newline (if
              multiline supported)
            </li>
          </ul>
        </div>

        <div style={{ "margin-top": "2em" }}>
          <h2 style={{ color: "#e5c07b", "margin-bottom": "0.5em" }}>Submitted Messages:</h2>
          {submittedMessages().length === 0 ? (
            <p style={{ color: "#6a6a6a" }}>No messages submitted yet...</p>
          ) : (
            <ul style={{ "padding-left": "2ch" }}>
              {submittedMessages().map((msg, idx) => (
                <li style={{ "margin-bottom": "0.5em" }}>
                  <span style={{ color: "#6a6a6a" }}>{idx + 1}.</span> <span style={{ color: "#d4d4d4" }}>{msg}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Terminal input at bottom */}
      <div style={{ position: "relative", height: "5em" }}>
        <TerminalInput
          value={inputValue()}
          onInput={setInputValue}
          onSubmit={handleSubmit}
          width={100}
          attachments={showAttachments() ? sampleAttachments : []}
        />
      </div>
    </div>
  )
}
