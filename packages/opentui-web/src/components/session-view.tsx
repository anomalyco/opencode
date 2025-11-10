import type { Component } from "solid-js"
import { Show, For, createEffect, createSignal } from "solid-js"
import { useSync } from "../context/sync"
import { SessionDetail } from "./session-detail"

export const SessionView: Component = () => {
  const sync = useSync()
  const [selectedSessionID, setSelectedSessionID] = createSignal<string | null>(null)

  createEffect(() => {
    console.log("Sessions:", sync.data.session.length)
    console.log("Ready:", sync.ready)
  })

  const handleSelectSession = async (sessionID: string) => {
    setSelectedSessionID(sessionID)
    await sync.session.sync(sessionID)
  }

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        flex: 1,
        overflow: "hidden",
      }}
    >
      <Show when={!sync.ready}>
        <div
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            flex: 1,
          }}
        >
          Loading...
        </div>
      </Show>

      <Show when={sync.ready && !selectedSessionID()}>
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            flex: 1,
            padding: "1rem",
            overflow: "auto",
          }}
        >
          <h1 style={{ "margin-bottom": "1rem" }}>OpenTUI Web</h1>

          <div style={{ "margin-bottom": "1rem" }}>
            <strong>Project:</strong> {sync.data.project.worktree}
          </div>

          <div style={{ "margin-bottom": "1rem" }}>
            <strong>Sessions ({sync.data.session.length}):</strong>
          </div>

          <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
            <For each={sync.data.session}>
              {(session) => (
                <button
                  onClick={() => handleSelectSession(session.id)}
                  style={{
                    padding: "0.75rem",
                    border: "1px solid #3e3e3e",
                    "border-radius": "4px",
                    background: "#252525",
                    color: "#d4d4d4",
                    "text-align": "left",
                    cursor: "pointer",
                    "font-family": "monospace",
                    "font-size": "0.95rem",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#2e2e2e"
                    e.currentTarget.style.borderColor = "#4ec9b0"
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#252525"
                    e.currentTarget.style.borderColor = "#3e3e3e"
                  }}
                >
                  <div>
                    <strong>ID:</strong> {session.id}
                  </div>
                  <div>
                    <strong>Title:</strong> {session.title}
                  </div>
                  <div>
                    <strong>Version:</strong> {session.version}
                  </div>
                  <Show when={sync.data.message[session.id]}>
                    <div style={{ "margin-top": "0.5rem" }}>
                      <strong>Messages:</strong> {sync.data.message[session.id]?.length || 0}
                    </div>
                  </Show>
                </button>
              )}
            </For>
          </div>

          <Show when={sync.data.session.length === 0}>
            <div style={{ "text-align": "center", color: "#888", padding: "2rem" }}>No sessions available</div>
          </Show>
        </div>
      </Show>

      <Show when={sync.ready && selectedSessionID()}>
        <SessionDetail sessionID={selectedSessionID()!} onBack={() => setSelectedSessionID(null)} />
      </Show>
    </div>
  )
}
