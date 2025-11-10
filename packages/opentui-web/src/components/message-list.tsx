import type { Component, JSX } from "solid-js"
import { Show, For, createEffect, createSignal } from "solid-js"
import type { Message, Part, TextPart, ToolPart, FilePart } from "@opencode-ai/sdk/client"
import { useSync } from "../context/sync"

interface MessageListProps {
  sessionID: string
}

const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

const ToolPartRenderer: Component<{ part: ToolPart; parts: Part[] }> = (props) => {
  const [expanded, setExpanded] = createSignal(false)
  const status = () => props.part.state.status
  const statusColor = () => {
    switch (status()) {
      case "completed":
        return "#4ec9b0"
      case "error":
        return "#f48771"
      case "running":
        return "#dcdcaa"
      default:
        return "#858585"
    }
  }

  return (
    <div style={{ "margin-bottom": "0.75rem", "border-left": `2px solid ${statusColor()}`, "padding-left": "0.75rem" }}>
      <button
        onClick={() => setExpanded(!expanded())}
        style={{
          background: "transparent",
          border: "none",
          color: statusColor(),
          cursor: "pointer",
          "font-family": "monospace",
          "font-size": "0.9rem",
          padding: "0.25rem",
          display: "flex",
          "align-items": "center",
          gap: "0.5rem",
        }}
      >
        <span>{expanded() ? "▼" : "▶"}</span>
        <span style={{ "font-weight": "bold" }}>{props.part.tool}</span>
        <span style={{ color: "#858585" }}>({status()})</span>
      </button>

      <Show when={expanded()}>
        <div style={{ "margin-top": "0.5rem", "padding-left": "0.5rem", color: "#a0a0a0" }}>
          <Show when={Object.keys(props.part.state.input).length > 0}>
            <div style={{ "margin-bottom": "0.5rem" }}>
              <div style={{ color: "#858585", "font-size": "0.85rem" }}>Input:</div>
              <pre
                style={{
                  background: "#252525",
                  padding: "0.5rem",
                  "border-radius": "2px",
                  overflow: "auto",
                  "font-size": "0.85rem",
                  margin: "0.25rem 0",
                }}
              >
                {JSON.stringify(props.part.state.input, null, 2)}
              </pre>
            </div>
          </Show>

          <Show when={status() === "completed" || status() === "error"}>
            <Show when={status() === "completed"}>
              <div style={{ "margin-bottom": "0.5rem" }}>
                <div style={{ color: "#858585", "font-size": "0.85rem" }}>Output:</div>
                <pre
                  style={{
                    background: "#252525",
                    padding: "0.5rem",
                    "border-radius": "2px",
                    overflow: "auto",
                    "font-size": "0.85rem",
                    margin: "0.25rem 0",
                    "word-wrap": "break-word",
                    "white-space": "pre-wrap",
                  }}
                >
                  {"output" in props.part.state ? props.part.state.output : ""}
                </pre>
              </div>
            </Show>

            <Show when={status() === "error"}>
              <div style={{ "margin-bottom": "0.5rem" }}>
                <div style={{ color: "#f48771", "font-size": "0.85rem" }}>Error:</div>
                <pre
                  style={{
                    background: "#252525",
                    padding: "0.5rem",
                    "border-radius": "2px",
                    overflow: "auto",
                    "font-size": "0.85rem",
                    margin: "0.25rem 0",
                    color: "#f48771",
                    "word-wrap": "break-word",
                    "white-space": "pre-wrap",
                  }}
                >
                  {"error" in props.part.state ? props.part.state.error : ""}
                </pre>
              </div>
            </Show>

            <Show
              when={
                (status() === "completed" || status() === "error") &&
                Object.keys((props.part.state as any).metadata || {}).length > 0
              }
            >
              <div style={{ "margin-bottom": "0.5rem" }}>
                <div style={{ color: "#858585", "font-size": "0.85rem" }}>Metadata:</div>
                <pre
                  style={{
                    background: "#252525",
                    padding: "0.5rem",
                    "border-radius": "2px",
                    overflow: "auto",
                    "font-size": "0.85rem",
                    margin: "0.25rem 0",
                  }}
                >
                  {JSON.stringify((props.part.state as any).metadata, null, 2)}
                </pre>
              </div>
            </Show>

            <Show when={(props.part.state as any).time}>
              <div style={{ color: "#858585", "font-size": "0.85rem" }}>
                Duration:{" "}
                {((((props.part.state as any).time?.end ?? 0) - (props.part.state as any).time!.start) / 1000).toFixed(
                  2,
                )}
                s
              </div>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  )
}

const TextPartRenderer: Component<{ part: TextPart }> = (props) => (
  <div
    style={{
      "margin-bottom": "0.75rem",
      "word-wrap": "break-word",
      "white-space": "pre-wrap",
      color: "#d4d4d4",
    }}
  >
    {props.part.text}
  </div>
)

const FilePartRenderer: Component<{ part: FilePart }> = (props) => (
  <div
    style={{
      "margin-bottom": "0.75rem",
      padding: "0.5rem",
      background: "#252525",
      "border-radius": "2px",
      border: "1px solid #3e3e3e",
    }}
  >
    <a
      href={props.part.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        color: "#4ec9b0",
        "text-decoration": "none",
        "font-size": "0.9rem",
      }}
    >
      📎 {props.part.filename || "File"}
    </a>
  </div>
)

const PartRenderer: Component<{ part: Part; allParts: Part[] }> = (props) => {
  return (
    <>
      <Show when={props.part.type === "text"}>
        <TextPartRenderer part={props.part as TextPart} />
      </Show>
      <Show when={props.part.type === "tool"}>
        <ToolPartRenderer part={props.part as ToolPart} parts={props.allParts} />
      </Show>
      <Show when={props.part.type === "file"}>
        <FilePartRenderer part={props.part as FilePart} />
      </Show>
      <Show when={!["text", "tool", "file"].includes(props.part.type)}>
        <div style={{ color: "#858585", "font-size": "0.85rem", "margin-bottom": "0.5rem" }}>[{props.part.type}]</div>
      </Show>
    </>
  )
}

export const MessageList: Component<MessageListProps> = (props) => {
  const sync = useSync()
  const [autoScroll, setAutoScroll] = createSignal(true)
  let messagesEndRef: HTMLDivElement | undefined

  const messages = () => sync.data.message[props.sessionID] ?? []
  const getMessageParts = (messageID: string): Part[] => sync.data.part[messageID] ?? []

  createEffect(() => {
    if (autoScroll() && messagesEndRef) {
      setTimeout(() => {
        messagesEndRef?.scrollIntoView({ behavior: "smooth" })
      }, 0)
    }
  })

  const handleScroll = (e: Event) => {
    const container = e.target as HTMLDivElement
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50
    setAutoScroll(isAtBottom)
  }

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        flex: 1,
        overflow: "hidden",
        background: "#1e1e1e",
      }}
    >
      <div
        style={{
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center",
          padding: "0.75rem",
          "border-bottom": "1px solid #3e3e3e",
        }}
      >
        <div style={{ color: "#858585", "font-size": "0.9rem" }}>Messages: {messages().length}</div>
        <button
          onClick={() => setAutoScroll(!autoScroll())}
          style={{
            background: autoScroll() ? "#3e3e3e" : "transparent",
            border: "1px solid #3e3e3e",
            color: autoScroll() ? "#4ec9b0" : "#858585",
            padding: "0.4rem 0.8rem",
            cursor: "pointer",
            "border-radius": "2px",
            "font-family": "monospace",
            "font-size": "0.85rem",
          }}
        >
          {autoScroll() ? "🔒 Auto-scroll" : "📌 Paused"}
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "1rem",
          display: "flex",
          "flex-direction": "column",
        }}
        onScroll={handleScroll}
      >
        <Show when={messages().length === 0}>
          <div
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              flex: 1,
              color: "#858585",
            }}
          >
            No messages yet
          </div>
        </Show>

        <For each={messages()}>
          {(message) => {
            const parts = getMessageParts(message.id)
            const actor = () => (message.role === "user" ? "👤 User" : "🤖 Assistant")
            const actorColor = () => (message.role === "user" ? "#ce9178" : "#4ec9b0")

            return (
              <div style={{ "margin-bottom": "1.5rem" }}>
                <div
                  style={{
                    display: "flex",
                    "justify-content": "space-between",
                    "align-items": "center",
                    "margin-bottom": "0.5rem",
                    "border-bottom": "1px solid #3e3e3e",
                    "padding-bottom": "0.5rem",
                  }}
                >
                  <span style={{ color: actorColor(), "font-weight": "bold" }}>{actor()}</span>
                  <span style={{ color: "#858585", "font-size": "0.8rem" }}>
                    {formatTimestamp(message.time.created)}
                  </span>
                </div>

                <div style={{ "padding-left": "0.5rem" }}>
                  <Show when={parts.length === 0}>
                    <div style={{ color: "#858585", "font-style": "italic" }}>(no parts)</div>
                  </Show>

                  <For each={parts}>{(part) => <PartRenderer part={part} allParts={parts} />}</For>
                </div>
              </div>
            )
          }}
        </For>

        <div ref={messagesEndRef} />
      </div>
    </div>
  )
}
