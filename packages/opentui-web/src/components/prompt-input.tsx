import type { Component } from "solid-js"
import { createSignal, createEffect, Show } from "solid-js"
import { useSync } from "../context/sync"
import { useSDK } from "../context/sdk"

interface PromptInputProps {
  sessionID: string
}

interface AttachedFile {
  id: string
  name: string
}

export const PromptInput: Component<PromptInputProps> = (props) => {
  const sync = useSync()
  const sdk = useSDK()
  const [message, setMessage] = createSignal("")
  const [isLoading, setIsLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [attachedFiles, setAttachedFiles] = createSignal<AttachedFile[]>([])
  let textareaRef: HTMLTextAreaElement | undefined
  let fileInputRef: HTMLInputElement | undefined

  // Auto-resize textarea as content grows
  const updateTextareaHeight = () => {
    if (textareaRef) {
      textareaRef.style.height = "auto"
      const newHeight = Math.min(textareaRef.scrollHeight, 200)
      textareaRef.style.height = `${newHeight}px`
    }
  }

  createEffect(() => {
    message()
    updateTextareaHeight()
  })

  const handleKeyDown = (e: KeyboardEvent) => {
    // Shift+Enter for newline, Enter to submit
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleFileSelect = (e: Event) => {
    const target = e.target as HTMLInputElement
    const files = target.files
    if (!files) return

    const newFiles: AttachedFile[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files.item(i)
      if (file) {
        newFiles.push({
          id: `${Date.now()}_${i}`,
          name: file.name,
        })
      }
    }

    setAttachedFiles((prev) => [...prev, ...newFiles])
    // Reset input
    if (fileInputRef) {
      fileInputRef.value = ""
    }
    setError(null)
  }

  const removeAttachment = (id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const handleSubmit = async () => {
    const trimmedMessage = message().trim()
    if (!trimmedMessage) {
      setError("Message cannot be empty")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      await sdk.client.session.message({
        path: { id: props.sessionID } as any,
        body: {
          message: trimmedMessage,
        } as any,
      })

      // Clear input on success
      setMessage("")
      setAttachedFiles([])
      if (textareaRef) {
        textareaRef.style.height = "auto"
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to send message"
      setError(errorMsg)
      console.error("Error sending message:", err)
    } finally {
      setIsLoading(false)
    }
  }

  const charCount = () => message().length
  const maxChars = 10000

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "0.75rem",
        padding: "1rem",
        "border-top": "1px solid #3e3e3e",
        background: "#1e1e1e",
      }}
    >
      {/* Error message */}
      <Show when={error()}>
        <div
          style={{
            padding: "0.75rem",
            background: "#3e2020",
            border: "1px solid #f48771",
            "border-radius": "4px",
            color: "#f48771",
            "font-size": "0.9rem",
          }}
        >
          {error()}
        </div>
      </Show>

      {/* Attached files */}
      <Show when={attachedFiles().length > 0}>
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            "flex-wrap": "wrap",
          }}
        >
          {attachedFiles().map((file) => (
            <div
              style={{
                display: "flex",
                "align-items": "center",
                gap: "0.5rem",
                padding: "0.4rem 0.75rem",
                background: "#252525",
                border: "1px solid #3e3e3e",
                "border-radius": "4px",
                "font-size": "0.85rem",
                color: "#d4d4d4",
              }}
            >
              <span>📎 {file.name}</span>
              <button
                onClick={() => removeAttachment(file.id)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#858585",
                  cursor: "pointer",
                  padding: "0",
                  "font-size": "1rem",
                  "line-height": "1",
                  transition: "color 0.2s",
                }}
                onMouseEnter={(e) => {
                  const btn = e.target as HTMLButtonElement
                  btn.style.color = "#f48771"
                }}
                onMouseLeave={(e) => {
                  const btn = e.target as HTMLButtonElement
                  btn.style.color = "#858585"
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </Show>

      {/* Input area */}
      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          "align-items": "flex-end",
        }}
      >
        {/* File attachment button */}
        <button
          onClick={() => fileInputRef?.click()}
          disabled={isLoading()}
          style={{
            "flex-shrink": 0,
            background: "transparent",
            border: "1px solid #3e3e3e",
            color: "#858585",
            padding: "0.6rem 0.8rem",
            cursor: isLoading() ? "not-allowed" : "pointer",
            "border-radius": "4px",
            "font-family": "monospace",
            "font-size": "0.9rem",
            transition: "all 0.2s",
            opacity: isLoading() ? 0.5 : 1,
          }}
          onMouseEnter={(e) => {
            if (!isLoading()) {
              const btn = e.target as HTMLButtonElement
              btn.style.borderColor = "#4ec9b0"
              btn.style.color = "#4ec9b0"
            }
          }}
          onMouseLeave={(e) => {
            const btn = e.target as HTMLButtonElement
            btn.style.borderColor = "#3e3e3e"
            btn.style.color = "#858585"
          }}
        >
          📎 Attach
        </button>

        <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} style={{ display: "none" }} />

        {/* Text input area */}
        <div
          style={{
            display: "flex",
            flex: 1,
            "flex-direction": "column",
            gap: "0.25rem",
          }}
        >
          <textarea
            ref={textareaRef}
            value={message()}
            onInput={(e) => setMessage(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            disabled={isLoading()}
            style={{
              flex: 1,
              width: "100%",
              "min-height": "40px",
              "max-height": "200px",
              padding: "0.75rem",
              background: "#252525",
              border: "1px solid #3e3e3e",
              color: "#d4d4d4",
              "font-family": "monospace",
              "font-size": "0.9rem",
              "border-radius": "4px",
              resize: "none",
              "overflow-y": "auto",
              outline: "none",
              transition: "border-color 0.2s",
              opacity: isLoading() ? 0.6 : 1,
            }}
            onFocus={(e) => {
              if (!isLoading()) {
                e.currentTarget.style.borderColor = "#4ec9b0"
              }
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "#3e3e3e"
            }}
          />

          {/* Character count and controls */}
          <div
            style={{
              display: "flex",
              "justify-content": "space-between",
              "align-items": "center",
              "padding-bottom": "0.25rem",
            }}
          >
            <div style={{ "font-size": "0.75rem", color: "#858585" }}>
              {charCount()} / {maxChars} characters
              <Show when={charCount() > maxChars * 0.9}>
                <span style={{ color: "#dcdcaa", "margin-left": "0.5rem" }}>⚠ Getting close to limit</span>
              </Show>
            </div>

            {/* Submit button */}
            <button
              onClick={handleSubmit}
              disabled={isLoading() || !message().trim()}
              style={{
                background: isLoading() || !message().trim() ? "#3e3e3e" : "#4ec9b0",
                border: "1px solid #4ec9b0",
                color: isLoading() || !message().trim() ? "#858585" : "#1e1e1e",
                padding: "0.4rem 1rem",
                cursor: isLoading() || !message().trim() ? "not-allowed" : "pointer",
                "border-radius": "4px",
                "font-family": "monospace",
                "font-size": "0.85rem",
                "font-weight": "bold",
                transition: "all 0.2s",
                opacity: isLoading() || !message().trim() ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                if (!isLoading() && message().trim()) {
                  const btn = e.target as HTMLButtonElement
                  btn.style.opacity = "0.9"
                }
              }}
              onMouseLeave={(e) => {
                if (!isLoading() && message().trim()) {
                  const btn = e.target as HTMLButtonElement
                  btn.style.opacity = "1"
                }
              }}
            >
              {isLoading() ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
