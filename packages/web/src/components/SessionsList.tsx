import { For, Show, createSignal, onMount } from "solid-js"
import { getSessions } from "../api"

interface Session {
  id: string
  sessionID: string
  createdAt: number
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`
  return `${Math.floor(diffDays / 365)} years ago`
}

export default function SessionsList() {
  const [sessions, setSessions] = createSignal<Session[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  onMount(async () => {
    try {
      const data = await getSessions()
      setSessions(data.sessions || [])
    } catch (err: any) {
      setError(err.message)
      console.error("Failed to fetch sessions:", err)
    } finally {
      setLoading(false)
    }
  })

  return (
    <div style={{ padding: "20px", "max-width": "1000px", margin: "0 auto" }}>
      <header style={{ "margin-bottom": "30px" }}>
        <h1 style={{ "margin-bottom": "10px" }}>Shared Sessions</h1>
        <p style={{ color: "#666" }}>Browse all OpenCode shared sessions</p>
      </header>

      <Show when={loading()}>
        <p>Loading sessions...</p>
      </Show>

      <Show when={error()}>
        <p style={{ color: "red" }}>Error: {error()}</p>
      </Show>

      <Show when={!loading() && !error() && sessions().length > 0}>
        <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fill, minmax(300px, 1fr))", gap: "20px" }}>
          <For each={sessions()}>
            {(session) => (
              <a
                href={`/s/${session.id}`}
                style={{
                  display: "block",
                  padding: "20px",
                  border: "1px solid #ddd",
                  "border-radius": "8px",
                  "text-decoration": "none",
                  color: "inherit",
                  transition: "box-shadow 0.2s",
                  "box-shadow": "0 1px 3px rgba(0,0,0,0.1)",
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)"
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)"
                }}
              >
                <div style={{ "margin-bottom": "10px" }}>
                  <h2 style={{ "margin-bottom": "5px", "word-break": "break-word" }}>
                    {session.sessionID?.slice(0, 20) || "Unknown"}...
                  </h2>
                  <span style={{ color: "#999", "font-size": "0.9em" }}>{formatDate(session.createdAt)}</span>
                </div>
                <p style={{ color: "#666", "font-size": "0.9em" }}>
                  Share ID:{" "}
                  <code style={{ "background-color": "#f5f5f5", padding: "2px 4px", "border-radius": "3px" }}>
                    {session.id}
                  </code>
                </p>
              </a>
            )}
          </For>
        </div>
      </Show>

      <Show when={!loading() && !error() && sessions().length === 0}>
        <p style={{ "text-align": "center", color: "#999" }}>No sessions found</p>
      </Show>
    </div>
  )
}
