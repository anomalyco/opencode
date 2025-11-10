import type { Component } from "solid-js"
import { Show, For, createSignal } from "solid-js"
import type { Message, Part, TextPart, ToolPart } from "@opencode-ai/sdk/client"

interface MessageBubbleProps {
  message: Message
  parts: Part[]
}

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  return date
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    })
    .toUpperCase()
}

const ToolBadge: Component<{ tool: string; status: string }> = (props) => {
  const bgColor = () => {
    switch (props.status) {
      case "completed":
        return "#3e3e3e"
      case "running":
        return "#4a4a2a"
      case "error":
        return "#4a2a2a"
      default:
        return "#2e2e2e"
    }
  }

  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.2rem 0.5rem",
        background: bgColor(),
        border: "1px solid #5e5e5e",
        "border-radius": "2px",
        "font-size": "0.7rem",
        "font-weight": "500",
        "text-transform": "uppercase",
        "letter-spacing": "0.05em",
        color: "#d4d4d4",
        "margin-right": "0.5rem",
        "font-family": '"Berkeley Mono", monospace',
      }}
    >
      {props.tool}
    </span>
  )
}

const ToolPartRenderer: Component<{ part: ToolPart }> = (props) => {
  const [expanded, setExpanded] = createSignal(false)

  const toolName = () => props.part.tool.toUpperCase()
  const status = () => props.part.state.status

  return (
    <div style={{ "margin-bottom": "0.5rem" }}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "0.5rem",
          "margin-bottom": expanded() ? "0.5rem" : "0",
          cursor: "pointer",
        }}
        onClick={() => setExpanded(!expanded())}
      >
        <span style={{ color: "#858585", "font-size": "0.85rem" }}>▶</span>
        <ToolBadge tool={toolName()} status={status()} />
        <Show
          when={
            status() === "completed" &&
            "metadata" in props.part.state &&
            (props.part.state as any).metadata?.description
          }
        >
          <span style={{ color: "#858585", "font-size": "0.85rem" }}>
            {(props.part.state as any).metadata?.description}
          </span>
        </Show>
      </div>

      <Show when={expanded() && status() === "completed"}>
        <div
          style={{
            "margin-left": "1.5rem",
            "padding-left": "1rem",
            "border-left": "2px solid #3e3e3e",
          }}
        >
          <Show when={Object.keys(props.part.state.input).length > 0}>
            <div style={{ "margin-bottom": "0.5rem" }}>
              <div style={{ color: "#858585", "font-size": "0.75rem", "margin-bottom": "0.25rem" }}>Input:</div>
              <pre
                style={{
                  background: "#252525",
                  padding: "0.5rem",
                  "border-radius": "2px",
                  "font-size": "0.75rem",
                  color: "#d4d4d4",
                  overflow: "auto",
                  margin: 0,
                }}
              >
                {JSON.stringify(props.part.state.input, null, 2)}
              </pre>
            </div>
          </Show>

          <Show when={"output" in props.part.state}>
            <div>
              <div style={{ color: "#858585", "font-size": "0.75rem", "margin-bottom": "0.25rem" }}>Output:</div>
              <pre
                style={{
                  background: "#252525",
                  padding: "0.5rem",
                  "border-radius": "2px",
                  "font-size": "0.75rem",
                  color: "#4ec9b0",
                  overflow: "auto",
                  margin: 0,
                  "white-space": "pre-wrap",
                  "word-wrap": "break-word",
                }}
              >
                {(props.part.state as any).output}
              </pre>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}

export const MessageBubble: Component<MessageBubbleProps> = (props) => {
  const isUser = () => props.message.role === "user"
  const username = () => (isUser() ? "jkneen" : "Assistant")
  const iconColor = () => (isUser() ? "#dcdcaa" : "#4ec9b0")

  return (
    <div style={{ padding: "1rem", "border-bottom": "1px solid #2e2e2e" }}>
      {/* Header: Timestamp and Username */}
      <div style={{ display: "flex", gap: "0.5rem", "align-items": "center", "margin-bottom": "0.75rem" }}>
        <Show when={isUser()}>
          <div
            style={{
              height: "3px",
              width: "100%",
              background: "#dcdcaa",
              "border-radius": "1px",
            }}
          />
        </Show>
        <Show when={!isUser()}>
          <span style={{ "font-size": "0.9rem" }}>🤖</span>
        </Show>
        <span style={{ color: "#858585", "font-size": "0.8rem" }}>({formatTime(props.message.time.created)})</span>
        <span style={{ color: iconColor(), "font-weight": "500", "font-size": "0.85rem" }}>{username()}</span>
      </div>

      {/* Content */}
      <div style={{ "padding-left": "1.5rem" }}>
        <For each={props.parts}>
          {(part) => (
            <>
              <Show when={part.type === "text"}>
                <div
                  style={{
                    color: "#d4d4d4",
                    "font-size": "0.85rem",
                    "line-height": "1.6",
                    "white-space": "pre-wrap",
                    "word-wrap": "break-word",
                    "margin-bottom": "0.5rem",
                    "font-family": '"Berkeley Mono", monospace',
                  }}
                >
                  {(part as TextPart).text}
                </div>
              </Show>

              <Show when={part.type === "tool"}>
                <ToolPartRenderer part={part as ToolPart} />
              </Show>
            </>
          )}
        </For>
      </div>
    </div>
  )
}
