import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/dialog-model"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import { useSDK } from "../../context/sdk"
import { useLocal } from "../../context/local"
import { useKV } from "../../context/kv"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "../../context/keybind"

type Sample = { time: number; bytes: number }

// Stall timeout options in milliseconds
const STALL_TIMEOUTS = [
  { label: "5s", ms: 5_000 },
  { label: "10s", ms: 10_000 },
  { label: "30s", ms: 30_000 },
  { label: "60s", ms: 60_000 },
  { label: "5m", ms: 5 * 60_000 },
  { label: "30m", ms: 30 * 60_000 },
  { label: "1h", ms: 60 * 60_000 },
] as const

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
  if (m < 60) return `${m}m${rem.toString().padStart(2, "0")}s`
  const h = Math.floor(m / 60)
  const remM = m % 60
  return `${h}h${remM.toString().padStart(2, "0")}m`
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0s"
  const s = Math.ceil(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.ceil(s / 60)
  return `${m}m`
}

// Throughput trend indicator using unicode blocks
function rateTrend(samples: Sample[], windowMs: number, buckets: number): string {
  const now = Date.now()
  const bucketSize = windowMs / buckets
  const counts: number[] = new Array(buckets).fill(0)
  
  for (const s of samples) {
    const age = now - s.time
    if (age > windowMs) continue
    const bucket = Math.floor(age / bucketSize)
    if (bucket >= 0 && bucket < buckets) {
      counts[buckets - 1 - bucket] += s.bytes // reverse so newest is rightmost
    }
  }
  
  const max = Math.max(...counts, 1)
  const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
  return counts.map(c => {
    const level = Math.floor((c / max) * 7)
    return blocks[level]
  }).join("")
}

type ActivityType = "idle" | "text" | "reasoning" | "tool" | "waiting"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const sdk = useSDK()
  const local = useLocal()
  const kv = useKV()
  const keybind = useKeybind()

  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const connected = useConnected()
  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : ""))
  
  // Model info for reasoning detection
  const isReasoningModel = createMemo(() => local.model.parsed().reasoning)

  // Stall timeout index (persisted)
  const getTimeoutIndex = () => kv.get("stall_timeout_index", 2) as number // default 30s
  const setTimeoutIndex = (idx: number) => kv.set("stall_timeout_index", idx)
  const currentTimeout = createMemo(() => STALL_TIMEOUTS[getTimeoutIndex()] ?? STALL_TIMEOUTS[2])

  // --- Telemetry state (mutable for perf, copied to reactive store on tick) ---
  let samplesRaw: Sample[] = []
  let totalBytesRaw = 0
  let startTimeRaw: number | undefined
  let busyRaw = false
  
  // Activity tracking
  let activityRaw: ActivityType = "idle"
  let activityStartRaw: number | undefined
  let lastToolRaw: string | undefined
  let lastActivityRaw: ActivityType = "idle"
  let lastByteTimeRaw: number | undefined
  
  // Retry tracking
  let retryRaw: { message: string; next: number } | undefined
  let retryCountRaw = 0
  
  // Auto-recovery tracking
  let recoveryTriggeredRaw = false
  let recoveryCountRaw = 0
  
  // Last user message for re-issue
  let lastUserMessageRaw: { text: string; parts: any[] } | undefined

  // Reactive store
  const [telemetry, setTelemetry] = createStore({
    busy: false,
    activity: "idle" as ActivityType,
    activityDuration: 0,
    activeTool: undefined as string | undefined,
    lastActivity: "idle" as ActivityType,
    lastTool: undefined as string | undefined,
    totalBytes: 0,
    elapsed: 0,
    r1: 0,
    r5: 0,
    r30: 0,
    r60: 0,
    trend: "",
    silenceDuration: 0,
    stalled: false,
    stallReason: "" as string,
    retry: undefined as { message: string; countdown: number } | undefined,
    retryCount: 0,
    isReasoning: false,
    // Auto-recovery
    timeoutLabel: "30s",
    timeoutMs: 30_000,
    recoveryCountdown: 0, // ms until auto-recovery
    recoveryCount: 0,
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

  async function triggerRecovery() {
    if (recoveryTriggeredRaw) return
    recoveryTriggeredRaw = true
    recoveryCountRaw++
    
    const sessionID = currentSessionID()
    if (!sessionID) return
    
    // Abort current request
    await sdk.client.session.abort({ sessionID }).catch(() => {})
    
    // Find last user message
    const messages = sync.data.message[sessionID] ?? []
    const lastUserMsg = messages.findLast((m) => m.role === "user")
    if (!lastUserMsg) {
      recoveryTriggeredRaw = false
      return
    }
    
    // Get parts from last user message
    const parts = sync.data.part[lastUserMsg.id] ?? []
    const textPart = parts.find((p) => p.type === "text" && !p.synthetic)
    if (!textPart || textPart.type !== "text") {
      recoveryTriggeredRaw = false
      return
    }
    
    // Revert to before last user message, then re-issue
    await sdk.client.session.revert({
      sessionID,
      messageID: lastUserMsg.id,
    }).catch(() => {})
    
    // Get current model
    const model = local.model.current()
    if (!model) {
      recoveryTriggeredRaw = false
      return
    }
    
    // Re-issue the prompt
    const nonTextParts = parts.filter((p) => p.type !== "text")
    await sdk.client.session.prompt({
      sessionID,
      providerID: model.providerID,
      modelID: model.modelID,
      agent: local.agent.current().name,
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
      },
      parts: [
        {
          id: `part_${Date.now()}`,
          type: "text",
          text: textPart.text,
        },
        ...nonTextParts.map((p, i) => ({
          id: `part_${Date.now()}_${i}`,
          ...p,
        })),
      ],
    }).catch(() => {})
    
    // Reset state - will be set fresh on next busy event
    recoveryTriggeredRaw = false
  }

  function refreshTelemetry() {
    const now = Date.now()
    const cutoff = now - 61_000
    samplesRaw = samplesRaw.filter((s) => s.time > cutoff)

    const elapsed = startTimeRaw ? now - startTimeRaw : 0
    const activityDuration = activityStartRaw ? now - activityStartRaw : 0
    const r1 = computeThroughput(1_000)
    const r5 = computeThroughput(5_000)
    const r30 = computeThroughput(30_000)
    const r60 = computeThroughput(60_000)
    const trend = rateTrend(samplesRaw, 10_000, 10)
    
    const silenceDuration = lastByteTimeRaw ? now - lastByteTimeRaw : (startTimeRaw ? now - startTimeRaw : 0)
    
    const isToolRunning = activityRaw === "tool"
    const isRetrying = !!retryRaw
    const stalled = busyRaw && !isToolRunning && !isRetrying && silenceDuration > 2000 && r1 < 10
    
    let stallReason = ""
    if (stalled) {
      const reasoning = isReasoningModel()
      if (reasoning) {
        stallReason = "thinking"
      } else if (retryCountRaw > 0) {
        stallReason = "likely rate limited"
      } else if (silenceDuration > 30000) {
        stallReason = "no response"
      } else if (silenceDuration > 10000) {
        stallReason = "waiting"
      } else {
        stallReason = "stall"
      }
    }

    let retry: { message: string; countdown: number } | undefined
    if (retryRaw) {
      const countdown = Math.max(0, Math.ceil((retryRaw.next - now) / 1000))
      retry = { message: retryRaw.message, countdown }
    }

    // Calculate recovery countdown
    const timeout = currentTimeout()
    let recoveryCountdown = 0
    if (busyRaw && !isToolRunning && silenceDuration > 2000) {
      recoveryCountdown = Math.max(0, timeout.ms - silenceDuration)
      
      // Trigger recovery if countdown reached zero
      if (recoveryCountdown <= 0 && !recoveryTriggeredRaw) {
        triggerRecovery()
      }
    }

    setTelemetry({
      busy: busyRaw,
      activity: activityRaw,
      activityDuration,
      activeTool: activityRaw === "tool" ? lastToolRaw : undefined,
      lastActivity: lastActivityRaw,
      lastTool: lastToolRaw,
      totalBytes: totalBytesRaw,
      elapsed,
      r1,
      r5,
      r30,
      r60,
      trend,
      silenceDuration,
      stalled,
      stallReason,
      retry,
      retryCount: retryCountRaw,
      isReasoning: isReasoningModel(),
      timeoutLabel: timeout.label,
      timeoutMs: timeout.ms,
      recoveryCountdown,
      recoveryCount: recoveryCountRaw,
    })
  }

  function setActivity(type: ActivityType, tool?: string) {
    if (activityRaw !== type || (type === "tool" && tool !== lastToolRaw)) {
      lastActivityRaw = activityRaw
      activityRaw = type
      activityStartRaw = Date.now()
      if (tool) lastToolRaw = tool
    }
  }

  // Tab to cycle FREE mode timeout
  useKeyboard((evt) => {
    if (!keybind.match("stall_timeout_cycle", evt)) return
    if (route.data.type !== "session") return
    
    const current = getTimeoutIndex()
    const next = (current + 1) % STALL_TIMEOUTS.length
    setTimeoutIndex(next)
    
    // Force refresh to show new timeout immediately
    refreshTelemetry()
  })

  // Track text streaming deltas
  sdk.event.on("message.part.updated", (evt) => {
    const part = evt.properties.part
    if (part.sessionID !== currentSessionID()) return

    if (part.type === "tool") {
      if (part.state.status === "running") {
        setActivity("tool", part.tool)
      } else if (part.state.status === "completed" || part.state.status === "error") {
        if (lastToolRaw === part.tool) {
          setActivity("waiting")
        }
      }
    }

    const delta = evt.properties.delta
    if (delta && (part.type === "text" || part.type === "reasoning")) {
      const bytes = new TextEncoder().encode(delta).length
      totalBytesRaw += bytes
      const now = Date.now()
      samplesRaw.push({ time: now, bytes })
      lastByteTimeRaw = now
      setActivity(part.type as ActivityType)
    }
  })

  // Track session status
  sdk.event.on("session.status", (evt) => {
    if (evt.properties.sessionID !== currentSessionID()) return
    const status = evt.properties.status
    if (status.type === "busy") {
      if (!busyRaw) {
        startTimeRaw = Date.now()
        totalBytesRaw = 0
        samplesRaw = []
        lastToolRaw = undefined
        lastByteTimeRaw = undefined
        retryCountRaw = 0
        recoveryTriggeredRaw = false
        setActivity("waiting")
      }
      busyRaw = true
      retryRaw = undefined
    } else if (status.type === "idle") {
      busyRaw = false
      retryRaw = undefined
      setActivity("idle")
    } else if (status.type === "retry") {
      retryRaw = { message: status.message, next: status.next }
      retryCountRaw++
      setActivity("waiting")
    }
  })

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
    onCleanup(() => timeouts.forEach(clearTimeout))
  })

  const activityDisplay = createMemo(() => {
    const act = telemetry.activity
    const tool = telemetry.activeTool
    const dur = formatElapsed(telemetry.activityDuration)
    
    if (act === "tool" && tool) {
      return { label: tool, duration: dur, color: theme.text }
    }
    if (act === "text") {
      return { label: "streaming", duration: dur, color: theme.success }
    }
    if (act === "reasoning") {
      return { label: "thinking", duration: dur, color: theme.info }
    }
    if (act === "waiting") {
      return { label: "waiting", duration: dur, color: theme.textMuted }
    }
    return { label: "", duration: "", color: theme.textMuted }
  })

  const silenceColor = createMemo(() => {
    const ms = telemetry.silenceDuration
    if (ms < 2000) return theme.success
    if (ms < 5000) return theme.warning
    if (ms < 10000) return theme.error
    return theme.error
  })

  // Show recovery countdown when stalled
  const showRecoveryCountdown = createMemo(() => {
    return telemetry.stalled && telemetry.recoveryCountdown > 0 && !telemetry.retry
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <Show
        when={telemetry.busy}
        fallback={
          <box flexDirection="row" gap={1}>
            <text fg={theme.textMuted}>{directory()}</text>
            <text fg={theme.textMuted}>
              FREE:{telemetry.timeoutLabel}
            </text>
          </box>
        }
      >
        <box flexDirection="row" gap={1} flexShrink={1} overflow="hidden">
          {/* Total elapsed */}
          <text fg={theme.textMuted}>
            {formatElapsed(telemetry.elapsed)}
          </text>
          
          {/* Current activity + duration */}
          <Show when={activityDisplay().label}>
            <text fg={activityDisplay().color}>
              {activityDisplay().label}
            </text>
            <text fg={theme.textMuted}>
              {activityDisplay().duration}
            </text>
          </Show>
          
          {/* Total bytes */}
          <text fg={theme.textMuted}>
            {formatBytes(telemetry.totalBytes)}
          </text>
          
          {/* Throughput sparkline */}
          <text fg={silenceColor()}>
            {telemetry.trend}
          </text>
          
          {/* Current rate */}
          <text fg={silenceColor()}>
            {formatRate(telemetry.r1)}/s
          </text>
          
          {/* Silence duration */}
          <Show when={telemetry.silenceDuration > 2000 && !telemetry.retry && telemetry.activity !== "tool"}>
            <text fg={theme.warning}>
              silent {formatElapsed(telemetry.silenceDuration)}
            </text>
          </Show>
          
          {/* Retry indicator */}
          <Show when={telemetry.retry}>
            <text fg={theme.warning}>
              {telemetry.retry!.message} ({telemetry.retry!.countdown}s)
            </text>
            <Show when={telemetry.retryCount > 1}>
              <text fg={theme.error}>
                x{telemetry.retryCount}
              </text>
            </Show>
          </Show>
          
          {/* Stall indicator with recovery countdown */}
          <Show when={telemetry.stalled && !telemetry.retry}>
            <text fg={telemetry.stallReason === "thinking" ? theme.info : theme.error}>
              {telemetry.stallReason.toUpperCase()}
            </text>
            <Show when={telemetry.lastTool && telemetry.lastActivity === "tool"}>
              <text fg={theme.textMuted}>
                after {telemetry.lastTool}
              </text>
            </Show>
          </Show>
          
          {/* Recovery countdown - FREE mode */}
          <Show when={showRecoveryCountdown()}>
            <text fg={theme.warning}>
              FREE:{formatCountdown(telemetry.recoveryCountdown)}
            </text>
          </Show>
          
          {/* Recovery count if we've auto-recovered */}
          <Show when={telemetry.recoveryCount > 0}>
            <text fg={theme.info}>
              retried:{telemetry.recoveryCount}
            </text>
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
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
