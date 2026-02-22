import type { FC } from "hono/jsx"
import { raw } from "hono/html"
import { marked } from "marked"
import Layout from "./layout.tsx"
import type { AgentSession, Message, Part } from "../types.ts"

// Configure marked for dark theme code blocks
marked.setOptions({ breaks: true, gfm: true })

const formatTime = (ts: number) =>
  new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

const formatCost = (cost: number) => (cost > 0 ? `$${cost.toFixed(4)}` : "")

const formatTokens = (tokens: {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}) =>
  `${tokens.input.toLocaleString()}in / ${tokens.output.toLocaleString()}out` +
  (tokens.reasoning > 0 ? ` / ${tokens.reasoning.toLocaleString()}reasoning` : "")

const renderMarkdown = (text: string) => raw(marked.parse(text) as string)

const TextPartView: FC<{ text: string }> = ({ text }) => <div class="text-content">{renderMarkdown(text)}</div>

const ToolPartView: FC<{ part: Part }> = ({ part }) => {
  const state = (part as any).state
  const status = state.status
  const name = (part as any).tool
  return (
    <div class="tool">
      <div class="tool-header">
        <span class="tool-name">{name}</span>
        <span class={`tool-status ${status}`}>{status}</span>
      </div>
      {state.title ? (
        <div class="meta" style="margin-bottom: 0.5rem;">
          {state.title}
        </div>
      ) : null}
      {status === "completed" && state.output ? (
        <details>
          <summary class="meta" style="cursor: pointer;">
            Output
          </summary>
          <div class="tool-output">
            <pre>
              <code>{state.output.length > 2000 ? state.output.slice(0, 2000) + "..." : state.output}</code>
            </pre>
          </div>
        </details>
      ) : null}
      {status === "error" ? <div style="color: #f87171; font-size: 12px;">{state.error}</div> : null}
    </div>
  )
}

const ReasoningPartView: FC<{ text: string }> = ({ text }) => <div class="reasoning">{text}</div>

const StepFinishView: FC<{ part: Part }> = ({ part }) => {
  const p = part as any
  return (
    <div class="step-finish">
      <span class="tokens">{formatTokens(p.tokens)}</span>
      {p.cost > 0 ? (
        <span class="cost" style="margin-left: 0.5rem;">
          {formatCost(p.cost)}
        </span>
      ) : null}
    </div>
  )
}

const PartView: FC<{ part: Part }> = ({ part }) => {
  if (part.type === "text") return <TextPartView text={(part as any).text} />
  if (part.type === "tool") return <ToolPartView part={part} />
  if (part.type === "reasoning") return <ReasoningPartView text={(part as any).text} />
  if (part.type === "step-finish") return <StepFinishView part={part} />
  return null
}

const MessageView: FC<{ message: Message; parts: Part[] }> = ({ message, parts }) => {
  const role = message.role
  const msg = message as any
  return (
    <div class={`message ${role}`} id={`msg-${message.id}`}>
      <div class="message-header">
        <span class={`role ${role}`}>{role}</span>
        <span class="meta">{formatTime(message.time.created)}</span>
      </div>
      {role === "assistant" ? (
        <div class="meta" style="margin-bottom: 0.5rem;">
          {msg.modelID} · {msg.providerID}
          {msg.cost > 0 ? (
            <span class="cost" style="margin-left: 0.5rem;">
              {formatCost(msg.cost)}
            </span>
          ) : null}
        </div>
      ) : null}
      <div class="message-parts">
        {parts.map((p) => (
          <PartView part={p} />
        ))}
      </div>
    </div>
  )
}

const SessionDetail: FC<{ session: AgentSession; shareID: string }> = ({ session, shareID }) => {
  const sorted = [...session.messages].sort((a, b) => a.time.created - b.time.created)
  const partsByMessage = new Map<string, Part[]>()
  for (const part of session.parts) {
    const list = partsByMessage.get(part.messageID) || []
    list.push(part)
    partsByMessage.set(part.messageID, list)
  }

  const totalCost = session.messages
    .filter((m) => m.role === "assistant")
    .reduce((sum, m) => sum + ((m as any).cost || 0), 0)
  const totalTokens = session.messages
    .filter((m) => m.role === "assistant")
    .reduce((sum, m) => sum + ((m as any).tokens?.input || 0) + ((m as any).tokens?.output || 0), 0)

  const safeSession = session.session || {}
  const safeTime = safeSession.time || { created: session.metadata.createdAt, updated: session.metadata.lastUpdated }
  return (
    <Layout title={safeSession.title || "Session"}>
      <div style="margin-bottom: 1.5rem;">
        <h1 style="font-size: 20px; margin-bottom: 0.25rem;">{safeSession.title || "Untitled Session"}</h1>
        <div class="meta">
          {safeSession.directory ? <span>{safeSession.directory} · </span> : null}
          <span>{session.messages.length} messages · </span>
          <span>{session.parts.length} parts · </span>
          <span class="cost">{formatCost(totalCost)}</span>
          {totalTokens > 0 ? <span> · {totalTokens.toLocaleString()} tokens</span> : null}
        </div>
        <div class="meta" style="margin-top: 0.25rem;">
          <span>Created {formatTime(safeTime.created)}</span>
          <span> · Updated {formatTime(session.metadata.lastUpdated)}</span>
          <span> · {session.metadata.syncCount} syncs</span>
        </div>
      </div>

      <div id="messages">
        {sorted.map((msg) => (
          <MessageView message={msg} parts={partsByMessage.get(msg.id) || []} />
        ))}
      </div>

      <script>
        {raw(`
        (() => {
          const poll = 30000
          const reconnect = 5000
          const wsUrl =
            (location.protocol === "https:" ? "wss:" : "ws:") +
            "//" +
            location.host +
            "/ws/${shareID}"

          const startPollingFallback = () => {
            const w = window
            if (w.__sessionPoll) clearInterval(w.__sessionPoll)
            w.__sessionPoll = window.setInterval(async () => {
              try {
                const response = await fetch(location.href, { cache: "no-store" })
                if (response.ok) location.reload()
              } catch {
                return
              }
            }, poll)
          }

          try {
            const ws = new WebSocket(wsUrl)
            ws.onclose = () => {
              setTimeout(() => location.reload(), reconnect)
            }
            ws.onerror = () => {
              startPollingFallback()
            }
            ws.onmessage = () => {
              location.reload()
            }
          } catch {
            startPollingFallback()
          }
        })()
      `)}
      </script>
    </Layout>
  )
}

export default SessionDetail
