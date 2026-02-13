import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/dialog-model"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import { useSDK } from "../../context/sdk"

type Sample = { time: number; bytes: number }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`
}

function formatRate(bytesPerSec: number): string {
  if (bytesPerSec === 0) return "0"
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)}`
  return `${(bytesPerSec / 1024).toFixed(1)}K`
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}m${rem.toString().padStart(2, "0")}s`
}

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const sdk = useSDK()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const connected = useConnected()
  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : ""))

  // --- Telemetry state ---
  let samplesRaw: Sample[] = []
  let totalBytesRaw = 0
  let startTimeRaw: number | undefined
  let activeToolRaw: string | undefined
  let busyRaw = false

  // Reactive store driven by interval refresh
  const [telemetry, setTelemetry] = createStore({
    busy: false,
    activeTool: undefined as string | undefined,
    totalBytes: 0,
    elapsed: 0,
    r1: 0,
    r5: 0,
    r30: 0,
    r60: 0,
    stalled: false,
  })

  function computeThroughput(windowMs: number): number {
    const now = Date.now()
    const cutoff = now - windowMs
    let total = 0
    for (const s of samplesRaw) {
      if (s.time > cutoff) total += s.bytes
    }
    const elapsed = startTimeRaw ? Math.min(windowMs, now - startTimeRaw) : 0
    if (elapsed <= 0) return 0
    return total / (elapsed / 1000)
  }

  function refreshTelemetry() {
    const now = Date.now()
    // Prune samples older than 61s
    const cutoff = now - 61_000
    samplesRaw = samplesRaw.filter((s) => s.time > cutoff)

    const elapsed = startTimeRaw ? now - startTimeRaw : 0
    const r1 = computeThroughput(1_000)
    const r5 = computeThroughput(5_000)
    const r30 = computeThroughput(30_000)
    const r60 = computeThroughput(60_000)
    // Only show STALL when stream is quiet AND no tool is running (tool execution is expected to be quiet)
    const stalled = busyRaw && !activeToolRaw && elapsed > 2000 && r1 < 10

    setTelemetry({
      busy: busyRaw,
      activeTool: activeToolRaw,
      totalBytes: totalBytesRaw,
      elapsed,
      r1,
      r5,
      r30,
      r60,
      stalled,
    })
  }

  // Track text streaming deltas
  sdk.event.on("message.part.updated", (evt) => {
    const part = evt.properties.part
    if (part.sessionID !== currentSessionID()) return

    // Track active tool
    if (part.type === "tool") {
      if (part.state.status === "running") {
        activeToolRaw = part.tool
      } else if (part.state.status === "completed" || part.state.status === "error") {
        if (activeToolRaw === part.tool) activeToolRaw = undefined
      }
    }

    // Track byte throughput from text and reasoning deltas
    const delta = evt.properties.delta
    if (delta && (part.type === "text" || part.type === "reasoning")) {
      const bytes = new TextEncoder().encode(delta).length
      totalBytesRaw += bytes
      samplesRaw.push({ time: Date.now(), bytes })
    }
  })

  // Track session status transitions
  sdk.event.on("session.status", (evt) => {
    if (evt.properties.sessionID !== currentSessionID()) return
    const status = evt.properties.status
    if (status.type === "busy") {
      if (!busyRaw) {
        startTimeRaw = Date.now()
        totalBytesRaw = 0
        samplesRaw = []
        activeToolRaw = undefined
      }
      busyRaw = true
    } else if (status.type === "idle") {
      busyRaw = false
      activeToolRaw = undefined
    }
  })

  // Tick every 200ms to refresh telemetry display
  onMount(() => {
    const timer = setInterval(() => refreshTelemetry(), 200)
    onCleanup(() => clearInterval(timer))
  })

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = []

    function tick() {
      if (connected()) return
      if (!store.welcome) {
        setStore("welcome", true)
        timeouts.push(setTimeout(() => tick(), 5000))
        return
      }

      if (store.welcome) {
        setStore("welcome", false)
        timeouts.push(setTimeout(() => tick(), 10_000))
        return
      }
    }
    timeouts.push(setTimeout(() => tick(), 10_000))

    onCleanup(() => {
      timeouts.forEach(clearTimeout)
    })
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <Show
        when={telemetry.busy}
        fallback={<text fg={theme.textMuted}>{directory()}</text>}
      >
        <box flexDirection="row" gap={1} flexShrink={1} overflow="hidden">
          <text fg={telemetry.stalled ? theme.warning : theme.textMuted}>
            {formatElapsed(telemetry.elapsed)}
          </text>
          <Show when={telemetry.activeTool}>
            <text fg={theme.text}>{telemetry.activeTool}</text>
          </Show>
          <text fg={telemetry.stalled ? theme.warning : theme.textMuted}>
            {formatBytes(telemetry.totalBytes)}
          </text>
          <text fg={telemetry.stalled ? theme.error : theme.textMuted}>
            {formatRate(telemetry.r1)}/s
          </text>
          <Show when={telemetry.elapsed > 5000}>
            <text fg={theme.textMuted}>
              5s:{formatRate(telemetry.r5)}
            </text>
          </Show>
          <Show when={telemetry.elapsed > 30000}>
            <text fg={theme.textMuted}>
              30s:{formatRate(telemetry.r30)}
            </text>
          </Show>
          <Show when={telemetry.elapsed > 60000}>
            <text fg={theme.textMuted}>
              60s:{formatRate(telemetry.r60)}
            </text>
          </Show>
          <Show when={telemetry.stalled}>
            <text fg={theme.error}>STALL</text>
          </Show>
        </box>
      </Show>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.textMuted }}>/connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>△</span> {permissions().length} Permission
                {permissions().length > 1 ? "s" : ""}
              </text>
            </Show>
            <text fg={theme.text}>
              <span style={{ fg: lsp().length > 0 ? theme.success : theme.textMuted }}>•</span> {lsp().length} LSP
            </text>
            <Show when={mcp()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.error }}>⊙ </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>⊙ </span>
                  </Match>
                </Switch>
                {mcp()} MCP
              </text>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
