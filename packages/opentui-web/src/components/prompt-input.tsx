import type { Component } from "solid-js"
import { createSignal, Show } from "solid-js"
import { useSDK } from "../context/sdk"

interface PromptInputProps {
  sessionID: string
}

export const PromptInput: Component<PromptInputProps> = (props) => {
  const sdk = useSDK()
  const [message, setMessage] = createSignal("")
  const [isLoading, setIsLoading] = createSignal(false)
  let textareaRef: HTMLTextAreaElement | undefined

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleSubmit = async () => {
    const trimmedMessage = message().trim()
    if (!trimmedMessage || isLoading()) return

    setIsLoading(true)

    try {
      await sdk.client.session.prompt({
        path: { id: props.sessionID },
        body: {
          parts: [
            {
              type: "text",
              text: trimmedMessage,
            },
          ],
        },
      })

      setMessage("")
    } catch (err) {
      console.error("Error sending message:", err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      style={{
        display: "flex",
        "align-items": "center",
        padding: "0.75rem 1rem",
        background: "#1a1a1a",
        gap: "0.5rem",
      }}
    >
      <span style={{ color: "#858585", "font-size": "0.85rem" }}>›</span>
      <input
        ref={(el) => (textareaRef = el as any)}
        type="text"
        value={message()}
        onInput={(e) => setMessage(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask OpenCode..."
        disabled={isLoading()}
        style={{
          flex: 1,
          padding: "0.5rem 0",
          background: "transparent",
          border: "none",
          color: "#d4d4d4",
          "font-family": '"Berkeley Mono", "Monaco", "Courier New", monospace',
          "font-size": "0.85rem",
          outline: "none",
          opacity: isLoading() ? 0.5 : 1,
        }}
      />
      <Show when={isLoading()}>
        <span style={{ color: "#4ec9b0", "font-size": "0.8rem" }}>●</span>
      </Show>
    </div>
  )
}
