import type { Component } from "solid-js"
import { createSignal } from "solid-js"
import { StyledDialog } from "../grid-components/Dialog"

export const DialogDemo: Component = () => {
  const [infoOpen, setInfoOpen] = createSignal(false)
  const [errorOpen, setErrorOpen] = createSignal(false)

  return (
    <div
      style={{
        padding: "2em",
        "font-family": '"Berkeley Mono", "JetBrains Mono", monospace',
        background: "#0a0a0a",
        "min-height": "100vh",
        color: "#ffffff",
      }}
    >
      <h1 style={{ "margin-bottom": "2em" }}>Dialog System Demo</h1>

      <div style={{ display: "flex", gap: "1em", "flex-direction": "column", "max-width": "400px" }}>
        <button
          onClick={() => setInfoOpen(true)}
          style={{
            background: "#61afef",
            color: "#ffffff",
            border: "none",
            padding: "1em 2em",
            "border-radius": "3px",
            "font-family": "inherit",
            "font-size": "16px",
            cursor: "pointer",
          }}
        >
          Show Info Dialog
        </button>

        <button
          onClick={() => setErrorOpen(true)}
          style={{
            background: "#e06c75",
            color: "#ffffff",
            border: "none",
            padding: "1em 2em",
            "border-radius": "3px",
            "font-family": "inherit",
            "font-size": "16px",
            cursor: "pointer",
          }}
        >
          Show Error Dialog
        </button>
      </div>

      {/* Info Dialog */}
      <StyledDialog
        variant="info"
        message="Tokens exceed context window (200,000). Creating new chat."
        actionLabel="Continue in new chat"
        onAction={() => {
          console.log("Action triggered: Continue in new chat")
          setInfoOpen(false)
        }}
        onClose={() => setInfoOpen(false)}
        isOpen={infoOpen()}
      />

      {/* Error Dialog */}
      <StyledDialog
        variant="error"
        message="An error occurred while processing your request. Please try again."
        actionLabel="Retry"
        onAction={() => {
          console.log("Action triggered: Retry")
          setErrorOpen(false)
        }}
        onClose={() => setErrorOpen(false)}
        isOpen={errorOpen()}
      />
    </div>
  )
}
