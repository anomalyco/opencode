import { createSignal, Show } from "solid-js"

export function App() {
  const [mode, setMode] = createSignal<"auto" | "interactive">("auto")
  const [browserUrl, setBrowserUrl] = createSignal("")
  const [browserRunning, setBrowserRunning] = createSignal(false)
  const [messages, setMessages] = createSignal<Array<{
    type: "user" | "assistant" | "tool" | "handoff"
    text: string
    icon?: string
  }>>([])
  const [input, setInput] = createSignal("")

  const toggleMode = () => setMode(m => m === "auto" ? "interactive" : "auto")

  const sendMessage = () => {
    const text = input().trim()
    if (!text) return
    setMessages(prev => [...prev, { type: "user", text }])
    setInput("")
    // TODO: Send to athena agent backend via Tauri IPC
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div class="app">
      {/* Header */}
      <div class="header">
        <div class="header-left">
          <div class="logo">
            <span class="diamond">◆</span>
            <span class="name">athena</span>
            <span class="sub">browser</span>
          </div>
          <div
            class={`mode-badge ${mode()}`}
            onClick={toggleMode}
            title="Click to switch mode"
          >
            {mode()}
          </div>
        </div>
        <div class="header-right">
          <div class={`status-dot ${browserRunning() ? "running" : "stopped"}`} />
          <span style={{ "font-size": "12px", color: "var(--text-muted)" }}>
            {browserRunning() ? "Browser running" : "Browser idle"}
          </span>
        </div>
      </div>

      {/* Main — split view */}
      <div class="main">
        {/* Left: Agent chat panel */}
        <div class="agent-panel">
          <div class="agent-header">
            Agent — {mode() === "auto" ? "autonomous" : "interactive"}
          </div>

          <div class="messages">
            <Show when={messages().length === 0}>
              <div style={{
                color: "var(--text-muted)",
                "font-size": "13px",
                "text-align": "center",
                "padding-top": "40px"
              }}>
                <div style={{ "font-size": "24px", "margin-bottom": "12px", opacity: 0.3 }}>◆</div>
                What would you like to automate?
              </div>
            </Show>

            {messages().map(msg => (
              <div class={`message ${msg.type}`}>
                <Show when={msg.type === "tool"}>
                  <span class="tool-icon">{msg.icon}</span>
                </Show>
                <Show when={msg.type === "handoff"}>
                  <div class="handoff-title">⏸ Human Action Required</div>
                </Show>
                {msg.text}
              </div>
            ))}
          </div>

          <div class="input-area">
            <div class="input-box">
              <textarea
                placeholder={mode() === "auto"
                  ? "Describe the task to automate..."
                  : "What would you like to do?"
                }
                value={input()}
                onInput={(e) => setInput(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                rows={1}
              />
            </div>
          </div>
        </div>

        {/* Right: Browser live view */}
        <div class="browser-panel">
          <Show when={browserUrl()}>
            <div class="url-bar">
              <span class="url-icon">◆</span>
              <span class="url-text">{browserUrl()}</span>
            </div>
          </Show>
          <div class="browser-viewport">
            <Show
              when={browserRunning()}
              fallback={
                <div class="browser-placeholder">
                  <div class="diamond-large">◆</div>
                  <div>Give a task to start the browser</div>
                  <div style={{ "margin-top": "8px", color: "var(--text-muted)", "font-size": "12px" }}>
                    "Go to google.com and search for..."
                  </div>
                </div>
              }
            >
              {/* Browser viewport stream connects here */}
              {/* agent-browser streams to ws://localhost:9223 */}
              <div style={{ color: "var(--text-muted)", "font-size": "13px" }}>
                Browser view streaming...
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
