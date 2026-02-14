import { useSync } from "@tui/context/sync"
import { createMemo, For, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import type { AssistantMessage, Part, ToolPart, TextPart, ReasoningPart } from "@weapon-ai/sdk/v2"
import { Installation } from "@/installation"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { useLocal } from "../../context/local"
import { TodoItem } from "../../component/todo-item"
import { calculateSessionMetrics, formatMs, formatTokenRate, formatPercent, getMessageStats } from "../../util/cic"

type ActivityItem = {
  id: string
  type: "tool" | "text" | "reasoning"
  label: string
  duration: number | null
  status: "running" | "completed" | "error" | "pending"
  time: number
  outcome: string
}

// Fixed-width sparkline from array of values
function sparkline(values: number[], width: number): string {
  const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
  if (values.length === 0) return blocks[0].repeat(width)
  const padded = values.length >= width ? values.slice(-width) : [...Array(width - values.length).fill(0), ...values]
  const max = Math.max(...padded, 0.001)
  return padded.map((v) => blocks[Math.min(7, Math.floor((v / max) * 7))]).join("")
}

// Format large numbers compactly
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

// Right-pad string to fixed width (right-align)
function rpad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : " ".repeat(w - s.length) + s
}

// Left-pad string to fixed width (left-align)
function lpad(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length)
}

// Extract argv[0] from a command string
function argv0(cmd: string): string {
  const trimmed = cmd.trim()
  // Handle common shell patterns like "cd dir && cmd" or just get first word
  const match = trimmed.match(/^(?:cd\s+[^\s;]+\s*(?:&&|;)\s*)?(\S+)/)
  return match?.[1] ?? trimmed.split(/\s/)[0] ?? "cmd"
}

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const local = useLocal()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  // Build activity log from all parts across all messages - NO FILTERING, full transparency
  const activity = createMemo((): ActivityItem[] => {
    const items: ActivityItem[] = []
    const msgs = messages()

    for (const msg of msgs) {
      if (msg.role !== "assistant") continue
      const parts = sync.data.part[msg.id] ?? []

      for (const part of parts) {
        if (part.type === "tool") {
          const p = part as ToolPart
          const state = p.state
          let duration: number | null = null
          let status: ActivityItem["status"] = "pending"
          let time = 0
          let outcome = ""

          // Get the actual command for bash tools (argv[0])
          let label = p.tool
          if (p.tool === "bash" && state.input && typeof state.input.command === "string") {
            label = argv0(state.input.command)
          }

          if (state.status === "running") {
            status = "running"
            time = state.time.start
            duration = Date.now() - state.time.start
            outcome = "..."
          } else if (state.status === "completed") {
            status = "completed"
            time = state.time.start
            duration = state.time.end - state.time.start
            const meta = state.metadata ?? {}
            if (meta.files !== undefined) {
              outcome = `${meta.files}f`
            } else if (meta.lines !== undefined) {
              outcome = `${meta.lines}ln`
            } else if (meta.matches !== undefined) {
              outcome = `${meta.matches}m`
            } else if (typeof meta.bytes === "number") {
              outcome = meta.bytes < 1024 ? `${meta.bytes}B` : `${(meta.bytes / 1024).toFixed(1)}K`
            }
          } else if (state.status === "error") {
            status = "error"
            time = state.time?.start ?? 0
            duration = state.time?.end ? state.time.end - state.time.start : null
            outcome = "err"
          }

          items.push({ id: p.id, type: "tool", label, duration, status, time, outcome })
        } else if (part.type === "reasoning") {
          const p = part as ReasoningPart
          const duration = p.time.end ? p.time.end - p.time.start : Date.now() - p.time.start
          const chars = p.text?.length ?? 0
          items.push({
            id: p.id,
            type: "reasoning",
            label: "think",
            duration,
            status: p.time.end ? "completed" : "running",
            time: p.time.start,
            outcome: chars > 1000 ? `${(chars / 1000).toFixed(1)}K` : `${chars}c`,
          })
        } else if (part.type === "text") {
          const p = part as TextPart
          if (p.synthetic || p.ignored) continue
          const duration = p.time?.end && p.time?.start ? p.time.end - p.time.start : null
          const chars = p.text?.length ?? 0
          items.push({
            id: p.id,
            type: "text",
            label: "text",
            duration,
            status: p.time?.end ? "completed" : "running",
            time: p.time?.start ?? 0,
            outcome: chars > 1000 ? `${(chars / 1000).toFixed(1)}K` : `${chars}c`,
          })
        }
      }
    }
    // Sort by time descending - show ALL items, no limit
    return items.sort((a, b) => b.time - a.time)
  })

  const [expanded, setExpanded] = createStore({
    todo: true,
    lsp: true,
  })

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total.toLocaleString(),
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  const cic = createMemo(() => calculateSessionMetrics(messages(), sync.data.part))

  // Per-message metrics for sparklines
  const messageMetrics = createMemo(() => {
    const msgs = messages().filter((m): m is AssistantMessage => m.role === "assistant")
    return msgs.map((msg) => {
      const parts = sync.data.part[msg.id] ?? []
      const stats = getMessageStats(msg, parts)
      return {
        ttft: stats.ttft ?? 0,
        tokensPerSec: stats.tokensPerSec ?? 0,
        cacheHit: stats.cacheHitRate ?? 0,
        output: msg.tokens.output + msg.tokens.reasoning,
      }
    })
  })

  // Tool stats
  const toolStats = createMemo(() => {
    const items = activity()
    const tools = items.filter((i) => i.type === "tool")
    const completed = tools.filter((t) => t.status === "completed")
    const errors = tools.filter((t) => t.status === "error")
    const running = tools.filter((t) => t.status === "running")
    const avgDuration =
      completed.length > 0 ? completed.reduce((s, t) => s + (t.duration ?? 0), 0) / completed.length : 0
    return {
      total: tools.length,
      completed: completed.length,
      errors: errors.length,
      running: running.length,
      avgDuration,
    }
  })

  // State histogram - time/count breakdown by activity type
  const stateHistogram = createMemo(() => {
    const items = activity()
    const toolTime = items.filter((i) => i.type === "tool").reduce((s, i) => s + (i.duration ?? 0), 0)
    const textTime = items.filter((i) => i.type === "text").reduce((s, i) => s + (i.duration ?? 0), 0)
    const thinkTime = items.filter((i) => i.type === "reasoning").reduce((s, i) => s + (i.duration ?? 0), 0)
    const totalTime = toolTime + textTime + thinkTime
    if (totalTime === 0) return null

    const toolPct = Math.round((toolTime / totalTime) * 100)
    const textPct = Math.round((textTime / totalTime) * 100)
    const thinkPct = Math.round((thinkTime / totalTime) * 100)

    // Build histogram bar (10 chars wide)
    const barWidth = 20
    const toolChars = Math.round((toolTime / totalTime) * barWidth)
    const textChars = Math.round((textTime / totalTime) * barWidth)
    const thinkChars = barWidth - toolChars - textChars
    const bar = "▓".repeat(toolChars) + "░".repeat(textChars) + "·".repeat(Math.max(0, thinkChars))

    return {
      bar,
      toolPct,
      textPct,
      thinkPct,
      toolCount: items.filter((i) => i.type === "tool").length,
      textCount: items.filter((i) => i.type === "text").length,
      thinkCount: items.filter((i) => i.type === "reasoning").length,
    }
  })

  const directory = useDirectory()
  const kv = useKV()

  const hasProviders = createMemo(() =>
    sync.data.provider.some((x) => x.id !== "weapon" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
  const gettingStartedDismissed = createMemo(() => kv.get("dismissed_getting_started", false))

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox flexGrow={1}>
          <box flexShrink={0} gap={1} paddingRight={1}>
            <box paddingRight={1}>
              <text fg={theme.text}>
                <b>{session().title}</b>
              </text>
              <Show when={session().share?.url}>
                <text fg={theme.textMuted}>{session().share!.url}</text>
              </Show>
            </box>
            {/* WEAPON HEADER */}
            <box>
              <text fg={theme.textMuted}>
                {"// WEAPON // "}
                <span style={{ fg: theme.text }}>
                  <b>{local.agent.current().name.toUpperCase()}</b>
                </span>
                {" //"}
              </text>
              <text fg={theme.textMuted}>
                {"// MODEL // "}
                <span style={{ fg: theme.text }}>{local.model.parsed().model.split("/").pop()?.toUpperCase()}</span>
                {" //"}
              </text>
            </box>
            {/* CONTEXT METRICS */}
            <box>
              <text fg={theme.textMuted}>
                {"// CTX // "}
                <span style={{ fg: theme.text }}>{compact(cic().inputTokens + cic().cacheRead)}</span>
                {" IN // "}
                <span style={{ fg: theme.text }}>{compact(cic().outputTokens + cic().reasoningTokens)}</span>
                {" OUT //"}
              </text>
              <text fg={theme.textMuted}>
                {"// LIMIT // "}
                <span style={{ fg: theme.text }}>{context()?.percentage ?? 0}%</span>
                {" // COST // "}
                <span style={{ fg: theme.warning }}>{cost()}</span>
                {" //"}
              </text>
            </box>
            {/* PERFORMANCE SPARKLINES */}
            <Show when={cic().messageCount > 0}>
              <box>
                <box flexDirection="row">
                  <text fg={theme.textMuted} width={5}>
                    TTFT
                  </text>
                  <text fg={theme.info}>
                    {sparkline(
                      messageMetrics().map((m) => m.ttft),
                      20,
                    )}
                  </text>
                  <text fg={theme.text}>{rpad(formatMs(cic().ttft).toUpperCase(), 6)}</text>
                </box>
                <box flexDirection="row">
                  <text fg={theme.textMuted} width={5}>
                    TK/S
                  </text>
                  <text fg={theme.success}>
                    {sparkline(
                      messageMetrics().map((m) => m.tokensPerSec),
                      20,
                    )}
                  </text>
                  <text fg={theme.text}>{rpad(formatTokenRate(cic().tokensPerSec).toUpperCase(), 6)}</text>
                </box>
                <box flexDirection="row">
                  <text fg={theme.textMuted} width={5}>
                    CACHE
                  </text>
                  <text fg={(cic().cacheHitRate ?? 0) > 50 ? theme.success : theme.warning}>
                    {sparkline(
                      messageMetrics().map((m) => m.cacheHit),
                      20,
                    )}
                  </text>
                  <text fg={(cic().cacheHitRate ?? 0) > 50 ? theme.success : theme.text}>
                    {rpad(formatPercent(cic().cacheHitRate).toUpperCase(), 6)}
                  </text>
                </box>
                <box flexDirection="row">
                  <text fg={theme.textMuted} width={5}>
                    OUT
                  </text>
                  <text fg={theme.primary}>
                    {sparkline(
                      messageMetrics().map((m) => m.output),
                      20,
                    )}
                  </text>
                  <text fg={theme.text}>{rpad(compact(cic().outputTokens + cic().reasoningTokens), 6)}</text>
                </box>
                <Show when={cic().messageCount > 1}>
                  <text fg={theme.textMuted}>
                    {"// AVG // "}
                    <span style={{ fg: theme.text }}>{formatTokenRate(cic().avgTokensPerSec).toUpperCase()}</span>
                    {" // P95 // "}
                    <span style={{ fg: theme.text }}>{formatMs(cic().p95Duration).toUpperCase()}</span>
                    {" //"}
                  </text>
                </Show>
              </box>
            </Show>
            {/* STATE HISTOGRAM */}
            <Show when={stateHistogram()}>
              <box>
                <text fg={theme.primary}>{stateHistogram()!.bar}</text>
                <text fg={theme.textMuted}>
                  {"// "}
                  <span style={{ fg: theme.primary }}>TOOL {stateHistogram()!.toolPct}%</span>
                  {" // "}
                  <span style={{ fg: theme.success }}>TEXT {stateHistogram()!.textPct}%</span>
                  <Show when={stateHistogram()!.thinkPct > 0}>
                    {" // "}
                    <span style={{ fg: theme.info }}>THINK {stateHistogram()!.thinkPct}%</span>
                  </Show>
                  {" //"}
                </text>
                <text fg={theme.textMuted}>
                  {"// "}
                  {stateHistogram()!.toolCount}T {" // "} {stateHistogram()!.textCount}S
                  <Show when={stateHistogram()!.thinkCount > 0}>
                    {" // "}
                    {stateHistogram()!.thinkCount}K
                  </Show>
                  {" //"}
                </text>
              </box>
            </Show>
            {/* TOOLS SUMMARY */}
            <Show when={toolStats().total > 0}>
              <text fg={theme.textMuted}>
                {"// TOOLS // "}
                <span style={{ fg: theme.success }}>{toolStats().completed} OK</span>
                <Show when={toolStats().running > 0}>
                  {" // "}
                  <span style={{ fg: theme.warning }}>{toolStats().running} RUN</span>
                </Show>
                <Show when={toolStats().errors > 0}>
                  {" // "}
                  <span style={{ fg: theme.error }}>{toolStats().errors} ERR</span>
                </Show>
                {" // ~"}
                {formatMs(toolStats().avgDuration).toUpperCase()}
                {" //"}
              </text>
            </Show>
            {/* ACTIVITY LOG */}
            <Show when={activity().length > 0}>
              <box>
                <For each={activity()}>
                  {(item) => {
                    const icons = {
                      tool: { running: "▣", completed: "■", error: "▨", pending: "□" },
                      reasoning: { running: "◧", completed: "◧", error: "▨", pending: "◧" },
                      text: { running: "▤", completed: "▤", error: "▨", pending: "▤" },
                    }
                    const icon = icons[item.type][item.status]
                    const color =
                      item.status === "running"
                        ? theme.warning
                        : item.status === "error"
                          ? theme.error
                          : item.status === "completed"
                            ? theme.success
                            : theme.textMuted
                    const labelText = lpad(item.label.toUpperCase(), 10)
                    const outcomeText = rpad(item.outcome.toUpperCase() || "", 6)
                    const durText =
                      item.duration && item.duration > 0 ? rpad(formatMs(item.duration).toUpperCase(), 5) : rpad("", 5)
                    return (
                      <text>
                        <span style={{ fg: color }}>{icon}</span>
                        <span style={{ fg: item.status === "running" ? theme.text : theme.textMuted }}>
                          {labelText}
                        </span>{" "}
                        <span style={{ fg: theme.textMuted }}>{outcomeText}</span>
                        <span style={{ fg: color }}>{durText}</span>
                      </text>
                    )
                  }}
                </For>
              </box>
            </Show>
            <box>
              <box
                flexDirection="row"
                gap={1}
                onMouseDown={() => sync.data.lsp.length > 2 && setExpanded("lsp", !expanded.lsp)}
              >
                <Show when={sync.data.lsp.length > 2}>
                  <text fg={theme.text}>{expanded.lsp ? "▼" : "▶"}</text>
                </Show>
                <text fg={theme.textMuted}>
                  {"// "}
                  <span style={{ fg: theme.text }}>
                    <b>LSP</b>
                  </span>
                  {" //"}
                </text>
              </box>
              <Show when={sync.data.lsp.length <= 2 || expanded.lsp}>
                <Show when={sync.data.lsp.length === 0}>
                  <text fg={theme.textMuted}>
                    {sync.data.config.lsp === false ? "DISABLED IN SETTINGS" : "ACTIVATES ON FILE READ"}
                  </text>
                </Show>
                <For each={sync.data.lsp}>
                  {(item) => (
                    <text fg={theme.textMuted}>
                      <span
                        style={{
                          fg: {
                            connected: theme.success,
                            error: theme.error,
                          }[item.status],
                        }}
                      >
                        {item.status === "connected" ? "■" : "▨"}
                      </span>{" "}
                      {item.id.toUpperCase()}
                    </text>
                  )}
                </For>
              </Show>
            </box>
            <Show when={todo().length > 0 && todo().some((t) => t.status !== "completed")}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => todo().length > 2 && setExpanded("todo", !expanded.todo)}
                >
                  <Show when={todo().length > 2}>
                    <text fg={theme.text}>{expanded.todo ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.textMuted}>
                    {"// "}
                    <span style={{ fg: theme.text }}>
                      <b>TODO</b>
                    </span>
                    {" //"}
                  </text>
                </box>
                <Show when={todo().length <= 2 || expanded.todo}>
                  <For each={todo()}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
                </Show>
              </box>
            </Show>
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <Show when={!hasProviders() && !gettingStartedDismissed()}>
            <box
              backgroundColor={theme.backgroundElement}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              paddingRight={2}
              flexDirection="row"
              gap={1}
            >
              <text flexShrink={0} fg={theme.text}>
                <b>GETTING STARTED</b>
              </text>
              <box>
                <text fg={theme.textMuted}>TYPE /CONNECT TO CONNECT TO A PROVIDER</text>
              </box>
            </box>
          </Show>
          <Show when={cic().inputTokens + cic().outputTokens > 0}>
            <text fg={theme.textMuted}>
              {"// TRAINING // DATA // "}
              <span style={{ fg: theme.warning }}>
                {(((cic().inputTokens + cic().outputTokens + cic().cacheRead) * 4) / 1024 / 1024).toFixed(2)}MB
              </span>
              {" //"}
            </text>
          </Show>
          <text fg={theme.textMuted}>
            {"// CWD // "}
            <span style={{ fg: theme.text }}>{directory().split("/").at(-1)?.toUpperCase()}</span>
            {" //"}
          </text>
          <text fg={theme.textMuted}>
            {"// "}
            <span style={{ fg: theme.success }}>ONLINE</span>
            {" // "}
            <span style={{ fg: theme.text }}>
              <b>WEAPON</b>
            </span>
            {" // "}
            <span>{Installation.VERSION}</span>
            {" //"}
          </text>
        </box>
      </box>
    </Show>
  )
}
