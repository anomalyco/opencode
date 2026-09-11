import { useCallback, useEffect, useState } from "react"
import { api, getServerUrl, setServerUrl, type Message, type SessionInfo } from "./api"

export function App() {
  const [serverUrl, setUrl] = useState(() => getServerUrl())
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [activeID, setActiveID] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshSessions = useCallback(async () => {
    setError(null)
    try {
      const data = await api.listSessions()
      setSessions(data)
      if (!activeID && data.length > 0) setActiveID(data[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [activeID])

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions, serverUrl])

  useEffect(() => {
    if (!activeID) return
    let cancelled = false
    api
      .getMessages(activeID)
      .then((m) => {
        if (!cancelled) setMessages(m)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [activeID])

  useEffect(() => api.subscribeEvents(() => void refreshSessions()), [refreshSessions])

  const saveServer = (v: string) => {
    setServerUrl(v)
    setUrl(v)
  }

  const create = async () => {
    setLoading(true)
    try {
      const s = await api.createSession("New session")
      setSessions((prev) => [s, ...prev])
      setActiveID(s.id)
      setMessages([])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const send = async () => {
    if (!activeID || !input.trim()) return
    setLoading(true)
    setError(null)
    try {
      await api.prompt(activeID, input)
      setInput("")
      const m = await api.getMessages(activeID)
      setMessages(m)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <strong>Argus Web</strong>
        <span className="muted">React + browser, no Electron, no CLI</span>
      </header>
      <div className="serverbar">
        <input
          value={serverUrl}
          onChange={(e) => saveServer(e.target.value)}
          placeholder="http://127.0.0.1:4096 (empty = same origin)"
        />
        <button onClick={() => void refreshSessions()}>Refresh</button>
        <button onClick={() => void create()} disabled={loading}>
          New session
        </button>
      </div>
      {error ? <div className="error">{error}</div> : null}
      <div className="layout">
        <aside className="sessions">
          {sessions.map((s) => (
            <button
              key={s.id}
              className={s.id === activeID ? "session active" : "session"}
              onClick={() => setActiveID(s.id)}
            >
              <div className="title">{String(s.title ?? s.id)}</div>
              <div className="id muted">{s.id}</div>
            </button>
          ))}
          {sessions.length === 0 ? <div className="muted">No sessions yet</div> : null}
        </aside>
        <main className="chat">
          <div className="messages">
            {messages.map((m) => (
              <div key={m.id} className="message">
                <div className="muted">{String(m.role ?? "message")} · {m.id}</div>
                <pre>{JSON.stringify(m.parts ?? m, null, 2)}</pre>
              </div>
            ))}
          </div>
          <div className="composer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a prompt…"
              rows={3}
            />
            <button onClick={() => void send()} disabled={loading || !activeID}>
              Send
            </button>
          </div>
        </main>
      </div>
    </div>
  )
}
