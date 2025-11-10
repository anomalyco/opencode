import type { Component } from "solid-js"
import { Show, createEffect, createSignal } from "solid-js"
import { useSync } from "../context/sync"
import { SessionListPanel } from "./session-list-panel"
import { SessionDetail } from "./session-detail"
import { Sidebar } from "./sidebar"
import { BottomBar } from "./bottom-bar"

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
      {/* Main content area with 3 panels */}
      <div
        style={{
          display: "flex",
          flex: 1,
          overflow: "hidden",
        }}
      >
        {/* Left: Session List Panel */}
        <SessionListPanel selectedSessionID={selectedSessionID()} onSelectSession={handleSelectSession} />

        {/* Center: Session Detail or Welcome Screen */}
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
                "align-items": "center",
                "justify-content": "center",
                flex: 1,
                padding: "2rem",
                "text-align": "center",
              }}
            >
              <div>🚀</div>
              <h1 style={{ margin: 0, "margin-bottom": "0.5rem", color: "#d4d4d4" }}>OpenTUI Web</h1>
              <p style={{ color: "#858585", "max-width": "400px" }}>
                Select a session from the left panel to get started
              </p>
              <div style={{ "margin-top": "2rem", color: "#858585" }}>
                <div style={{ "margin-bottom": "0.5rem" }}>
                  <strong>Project:</strong> {sync.data.project.worktree.split("/").pop()}
                </div>
                <div>
                  <strong>Sessions:</strong> {sync.data.session.length}
                </div>
              </div>
            </div>
          </Show>

          <Show when={sync.ready && selectedSessionID()}>
            <SessionDetail sessionID={selectedSessionID()!} onBack={() => setSelectedSessionID(null)} />
          </Show>
        </div>

        {/* Right: Sidebar (only show when session is selected) */}
        <Show when={sync.ready && selectedSessionID()}>
          <Sidebar sessionID={selectedSessionID()!} onNavigateToSession={handleSelectSession} />
        </Show>
      </div>

      {/* Bottom Bar - spans full width */}
      <Show when={sync.ready && selectedSessionID()}>
        <BottomBar sessionID={selectedSessionID()!} />
      </Show>
    </div>
  )
}
