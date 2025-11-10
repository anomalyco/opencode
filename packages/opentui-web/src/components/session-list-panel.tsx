import type { Component } from "solid-js"
import { For, Show, createSignal, createMemo } from "solid-js"
import { useSync } from "../context/sync"

interface SessionListPanelProps {
  selectedSessionID: string | null
  onSelectSession: (sessionID: string) => void
  class?: string
}

export const SessionListPanel: Component<SessionListPanelProps> = (props) => {
  const sync = useSync()
  const [displayLimit, setDisplayLimit] = createSignal(20)
  const [searchQuery, setSearchQuery] = createSignal("")

  const allSessions = createMemo(() => {
    const query = searchQuery().toLowerCase()
    return sync.data.session
      .filter((x) => x.parentID === undefined)
      .filter((x) => {
        // Filter garbage titles
        const title = x.title.toLowerCase()
        const isGarbage =
          title.includes("clarifying") ||
          title.includes("parsing") ||
          title.includes("invalid input") ||
          title.includes("discussing adsad") ||
          title.startsWith("new session -")
        if (isGarbage) return false

        // Apply search filter
        if (query) {
          return title.includes(query) || x.id.toLowerCase().includes(query)
        }
        return true
      })
      .sort((a, b) => b.time.updated - a.time.updated)
  })

  const displayedSessions = createMemo(() => allSessions().slice(0, displayLimit()))
  const hasMore = createMemo(() => allSessions().length > displayLimit())
  const needsMoreFromAPI = createMemo(() => sync.data.session.length === sync.data.limit)

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp)
    const now = new Date()
    const today = new Date().toDateString()
    const dateStr = date.toDateString()

    if (dateStr === today) {
      return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
    }

    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toDateString()
    if (dateStr === yesterday) {
      return "Yesterday"
    }

    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  const groupSessionsByDate = createMemo(() => {
    const groups: { [key: string]: Array<ReturnType<typeof displayedSessions>[number]> } = {}
    const today = new Date().toDateString()

    displayedSessions().forEach((session) => {
      const date = new Date(session.time.updated)
      let category = date.toDateString()
      if (category === today) {
        category = "Today"
      } else {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString()
        if (category === yesterday) {
          category = "Yesterday"
        } else {
          category = date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
        }
      }

      if (!groups[category]) {
        groups[category] = []
      }
      groups[category]!.push(session)
    })

    return Object.entries(groups)
  })

  return (
    <div
      class={props.class}
      style={{
        display: "flex",
        "flex-direction": "column",
        width: "320px",
        background: "#1a1a1a",
        "border-right": "1px solid #3e3e3e",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "1rem",
          "border-bottom": "1px solid #3e3e3e",
        }}
      >
        <h2 style={{ margin: 0, "margin-bottom": "0.75rem", "font-size": "1.1rem", color: "#d4d4d4" }}>Sessions</h2>

        {/* Search */}
        <input
          type="text"
          placeholder="Search sessions..."
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
          style={{
            width: "100%",
            padding: "0.5rem",
            background: "#252525",
            border: "1px solid #3e3e3e",
            "border-radius": "4px",
            color: "#d4d4d4",
            "font-family": "monospace",
            "font-size": "0.85rem",
            outline: "none",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "#4ec9b0"
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "#3e3e3e"
          }}
        />

        {/* Project Info */}
        <div style={{ "margin-top": "0.75rem", "font-size": "0.8rem", color: "#858585" }}>
          <div style={{ "margin-bottom": "0.25rem" }}>
            <strong>Project:</strong> {sync.data.project.worktree.split("/").pop()}
          </div>
          <div>
            <strong>Total:</strong> {allSessions().length} sessions
          </div>
        </div>
      </div>

      {/* Session List */}
      <div
        style={{
          flex: 1,
          "overflow-y": "auto",
          "overflow-x": "hidden",
        }}
      >
        <Show when={!sync.ready}>
          <div
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              padding: "2rem",
              color: "#858585",
            }}
          >
            Loading...
          </div>
        </Show>

        <Show when={sync.ready && displayedSessions().length === 0}>
          <div
            style={{
              display: "flex",
              "flex-direction": "column",
              "align-items": "center",
              "justify-content": "center",
              padding: "2rem",
              color: "#858585",
              "text-align": "center",
            }}
          >
            <div style={{ "font-size": "2rem", "margin-bottom": "0.5rem" }}>📭</div>
            <div style={{ "font-size": "0.9rem" }}>
              {searchQuery() ? "No sessions match your search" : "No sessions available"}
            </div>
          </div>
        </Show>

        <Show when={sync.ready && displayedSessions().length > 0}>
          <For each={groupSessionsByDate()}>
            {([category, sessions]) => (
              <div>
                {/* Date Category Header */}
                <div
                  style={{
                    padding: "0.5rem 1rem",
                    "font-size": "0.75rem",
                    "font-weight": "bold",
                    color: "#858585",
                    "text-transform": "uppercase",
                    "letter-spacing": "0.05em",
                    background: "#1a1a1a",
                    "border-bottom": "1px solid #2e2e2e",
                    position: "sticky",
                    top: 0,
                    "z-index": 1,
                  }}
                >
                  {category}
                </div>

                {/* Sessions in this category */}
                <For each={sessions}>
                  {(session) => {
                    const isSelected = () => props.selectedSessionID === session.id
                    const messageCount = () => sync.data.message[session.id]?.length || 0

                    return (
                      <button
                        onClick={() => props.onSelectSession(session.id)}
                        style={{
                          width: "100%",
                          padding: "0.75rem 1rem",
                          border: "none",
                          "border-bottom": "1px solid #2e2e2e",
                          background: isSelected() ? "#2e2e2e" : "transparent",
                          "border-left": isSelected() ? "3px solid #4ec9b0" : "3px solid transparent",
                          color: "#d4d4d4",
                          "text-align": "left",
                          cursor: "pointer",
                          "font-family": "monospace",
                          "font-size": "0.85rem",
                          transition: "all 0.15s",
                          display: "block",
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected()) {
                            e.currentTarget.style.background = "#252525"
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected()) {
                            e.currentTarget.style.background = "transparent"
                          }
                        }}
                      >
                        <div
                          style={{
                            "font-weight": isSelected() ? "bold" : "normal",
                            "margin-bottom": "0.25rem",
                            color: isSelected() ? "#4ec9b0" : "#d4d4d4",
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap",
                          }}
                        >
                          {session.title}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            "justify-content": "space-between",
                            "font-size": "0.75rem",
                            color: "#858585",
                          }}
                        >
                          <span>{messageCount()} messages</span>
                          <span>{formatTime(session.time.updated)}</span>
                        </div>
                      </button>
                    )
                  }}
                </For>
              </div>
            )}
          </For>

          {/* Load More Button */}
          <Show when={hasMore() || needsMoreFromAPI()}>
            <button
              onClick={async () => {
                if (needsMoreFromAPI()) {
                  await sync.session.fetch(50)
                }
                setDisplayLimit((prev) => prev + 20)
              }}
              style={{
                width: "100%",
                padding: "0.75rem 1rem",
                border: "none",
                "border-top": "1px solid #3e3e3e",
                background: "transparent",
                color: "#4ec9b0",
                cursor: "pointer",
                "font-family": "monospace",
                "font-size": "0.85rem",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#252525"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent"
              }}
            >
              Load more...{" "}
              {needsMoreFromAPI()
                ? "(fetching from server...)"
                : `(${allSessions().length - displayLimit()} remaining)`}
            </button>
          </Show>
        </Show>
      </div>
    </div>
  )
}
