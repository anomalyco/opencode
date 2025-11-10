import type { Component } from "solid-js"
import { Show, For, createSignal } from "solid-js"
import type { FileDiff, Todo } from "@opencode-ai/sdk/client"
import { useSync } from "../context/sync"
import { MessageList } from "./message-list"
import { PromptInput } from "./prompt-input"

interface SessionDetailProps {
  sessionID: string
  onBack: () => void
}

type TabName = "messages" | "todos" | "diffs"

const FileDiffRenderer: Component<{ diff: FileDiff }> = (props) => (
  <div
    style={{
      "margin-bottom": "1rem",
      padding: "0.75rem",
      background: "#252525",
      border: "1px solid #3e3e3e",
      "border-radius": "4px",
    }}
  >
    <div style={{ color: "#4ec9b0", "margin-bottom": "0.5rem", "word-break": "break-all" }}>{props.diff.file}</div>
    <Show when={props.diff.additions || props.diff.deletions}>
      <div style={{ color: "#858585", "font-size": "0.9rem", "margin-top": "0.25rem" }}>
        <Show when={props.diff.additions}>
          <span style={{ color: "#4ec9b0" }}>+{props.diff.additions}</span>{" "}
        </Show>
        <Show when={props.diff.deletions}>
          <span style={{ color: "#f48771" }}>-{props.diff.deletions}</span>
        </Show>
      </div>
    </Show>
  </div>
)

const TodoRenderer: Component<{ todo: Todo }> = (props) => {
  const statusColor = () => {
    switch (props.todo.status) {
      case "completed":
        return "#4ec9b0"
      case "in_progress":
        return "#dcdcaa"
      case "cancelled":
        return "#f48771"
      default:
        return "#858585"
    }
  }

  const statusIcon = () => {
    switch (props.todo.status) {
      case "completed":
        return "✓"
      case "in_progress":
        return "⟳"
      case "cancelled":
        return "✗"
      default:
        return "◯"
    }
  }

  return (
    <div
      style={{
        padding: "0.75rem",
        "margin-bottom": "0.75rem",
        background: "#252525",
        border: `1px solid ${statusColor()}`,
        "border-radius": "4px",
      }}
    >
      <div style={{ display: "flex", gap: "0.5rem", "align-items": "flex-start" }}>
        <span style={{ color: statusColor(), "font-weight": "bold" }}>{statusIcon()}</span>
        <div style={{ flex: 1 }}>
          <div style={{ color: "#d4d4d4" }}>{props.todo.content}</div>
          <div style={{ color: "#858585", "font-size": "0.85rem", "margin-top": "0.25rem" }}>
            Priority: {props.todo.priority}
          </div>
        </div>
      </div>
    </div>
  )
}

export const SessionDetail: Component<SessionDetailProps> = (props) => {
  const sync = useSync()
  const [activeTab, setActiveTab] = createSignal<TabName>("messages")

  const session = () => sync.session.get(props.sessionID)
  const todos = () => sync.data.todo[props.sessionID] ?? []
  const diffs = () => sync.data.session_diff[props.sessionID] ?? []

  const hasTodos = () => todos().length > 0
  const hasDiffs = () => diffs().length > 0

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        flex: 1,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "1rem",
          "border-bottom": "1px solid #3e3e3e",
          background: "#1e1e1e",
        }}
      >
        <div
          style={{
            display: "flex",
            "justify-content": "space-between",
            "align-items": "center",
            "margin-bottom": "1rem",
          }}
        >
          <div>
            <h2 style={{ margin: 0, "margin-bottom": "0.5rem" }}>Session Details</h2>
            <Show when={session()}>
              <div style={{ color: "#858585", "font-size": "0.9rem" }}>
                <div>ID: {session()?.id}</div>
                <div>Title: {session()?.title}</div>
                <div>Version: {session()?.version}</div>
              </div>
            </Show>
          </div>
          <button
            onClick={props.onBack}
            style={{
              background: "transparent",
              border: "1px solid #3e3e3e",
              color: "#858585",
              padding: "0.5rem 1rem",
              cursor: "pointer",
              "border-radius": "4px",
              "font-family": "monospace",
              "font-size": "0.9rem",
            }}
          >
            ← Back
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={() => setActiveTab("messages")}
            style={{
              background: activeTab() === "messages" ? "#3e3e3e" : "transparent",
              border: activeTab() === "messages" ? "1px solid #4ec9b0" : "1px solid #3e3e3e",
              color: activeTab() === "messages" ? "#4ec9b0" : "#858585",
              padding: "0.5rem 1rem",
              cursor: "pointer",
              "border-radius": "4px",
              "font-family": "monospace",
              "font-size": "0.9rem",
              transition: "all 0.2s",
            }}
          >
            Messages
          </button>

          <Show when={hasTodos()}>
            <button
              onClick={() => setActiveTab("todos")}
              style={{
                background: activeTab() === "todos" ? "#3e3e3e" : "transparent",
                border: activeTab() === "todos" ? "1px solid #4ec9b0" : "1px solid #3e3e3e",
                color: activeTab() === "todos" ? "#4ec9b0" : "#858585",
                padding: "0.5rem 1rem",
                cursor: "pointer",
                "border-radius": "4px",
                "font-family": "monospace",
                "font-size": "0.9rem",
                transition: "all 0.2s",
              }}
            >
              Todos ({todos().length})
            </button>
          </Show>

          <Show when={hasDiffs()}>
            <button
              onClick={() => setActiveTab("diffs")}
              style={{
                background: activeTab() === "diffs" ? "#3e3e3e" : "transparent",
                border: activeTab() === "diffs" ? "1px solid #4ec9b0" : "1px solid #3e3e3e",
                color: activeTab() === "diffs" ? "#4ec9b0" : "#858585",
                padding: "0.5rem 1rem",
                cursor: "pointer",
                "border-radius": "4px",
                "font-family": "monospace",
                "font-size": "0.9rem",
                transition: "all 0.2s",
              }}
            >
              Diffs ({diffs().length})
            </button>
          </Show>
        </div>
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", "flex-direction": "column" }}>
        <Show when={activeTab() === "messages"}>
          <div style={{ display: "flex", "flex-direction": "column", flex: 1, overflow: "hidden" }}>
            <MessageList sessionID={props.sessionID} />
            <PromptInput sessionID={props.sessionID} />
          </div>
        </Show>

        <Show when={activeTab() === "todos" && hasTodos()}>
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: "1rem",
            }}
          >
            <For each={todos()}>{(todo) => <TodoRenderer todo={todo} />}</For>
          </div>
        </Show>

        <Show when={activeTab() === "diffs" && hasDiffs()}>
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: "1rem",
            }}
          >
            <For each={diffs()}>{(diff) => <FileDiffRenderer diff={diff} />}</For>
          </div>
        </Show>
      </div>
    </div>
  )
}
