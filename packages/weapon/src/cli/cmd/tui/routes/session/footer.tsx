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

// State machine types
type FSMState = "idle" | "think" | "stream" | "tool" | "wait" | "stall" | "retry"
type StateTransition = { from: FSMState; to: FSMState; time: number; tool?: string }

// Mode options: LOCKED (no auto-recovery) or ARMED with timeout
const MODE_OPTIONS = [
  { mode: "locked" as const, label: "LOCKED", ms: undefined },
  { mode: "armed" as const, label: "ARMED 1s", ms: 1_000 },
  { mode: "armed" as const, label: "ARMED 5s", ms: 5_000 },
  { mode: "armed" as const, label: "ARMED 30s", ms: 30_000 },
  { mode: "armed" as const, label: "ARMED 1m", ms: 60_000 },
  { mode: "armed" as const, label: "ARMED 10m", ms: 10 * 60_000 },
  { mode: "armed" as const, label: "ARMED 1h", ms: 60 * 60_000 },
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

// Format cost compactly
function formatCost(dollars: number): string {
  if (dollars < 0.01) return `$${(dollars * 100).toFixed(1)}c`
  if (dollars < 1) return `$${dollars.toFixed(2)}`
  return `$${dollars.toFixed(2)}`
}

// Format cost rate (per minute)
function formatCostRate(dollarsPerMin: number): string {
  if (dollarsPerMin < 0.001) return "$0/m"
  if (dollarsPerMin < 0.01) return `$${(dollarsPerMin * 100).toFixed(1)}c/m`
  return `$${dollarsPerMin.toFixed(2)}/m`
}

// State symbols for FSM display - squarish/blocky for legibility
const STATE_SYMBOLS: Record<FSMState, string> = {
  idle: "■",
  think: "◧",
  stream: "▤",
  tool: "▣",
  wait: "□",
  stall: "▨",
  retry: "↻",
}

// Extract argv[0] from bash command
function argv0(cmd: string): string {
  const trimmed = cmd.trim()
  const match = trimmed.match(/^(?:cd\s+[^\s;]+\s*(?:&&|;)\s*)?(\S+)/)
  return match?.[1] ?? trimmed.split(/\s/)[0] ?? "cmd"
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
  return counts
    .map((c) => {
      const level = Math.floor((c / max) * 7)
      return blocks[level]
    })
    .join("")
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

  // Mode index (persisted) - default to ARMED 30s (index 3)
  const getModeIndex = () => kv.get("mode_index", 3) as number
  const setModeIndex = (idx: number) => kv.set("mode_index", idx)
  const currentMode = createMemo(() => MODE_OPTIONS[getModeIndex()] ?? MODE_OPTIONS[3])

  // --- Telemetry state (mutable for perf, copied to reactive store on tick) ---
  let samplesRaw: Sample[] = []
  let totalBytesRaw = 0
  let startTimeRaw: number | undefined
  let busyRaw = false

  // Activity tracking
  let activityRaw: ActivityType = "idle"
  let activityStartRaw: number | undefined
  let lastToolRaw: string | undefined
  let lastToolArgsRaw: string | undefined // For argv[0]
  let lastActivityRaw: ActivityType = "idle"
  let lastByteTimeRaw: number | undefined

  // FSM state machine tracking
  let fsmStateRaw: FSMState = "idle"
  let fsmTransitionsRaw: StateTransition[] = []
  let fsmDepthRaw = 0 // Agentic loop depth (tool call nesting)
  let fsmLoopCountRaw = 0 // Number of tool→wait→tool cycles
  let fsmToolCountRaw = 0 // Total tool calls this turn
  let fsmLastToolStartRaw: number | undefined

  // Cost tracking
  let sessionCostRaw = 0
  let lastTurnCostRaw = 0
  let turnStartTimeRaw: number | undefined

  // Time spent in each state (for histogram)
  let stateTimeRaw: Record<FSMState, number> = {
    idle: 0,
    think: 0,
    stream: 0,
    tool: 0,
    wait: 0,
    stall: 0,
    retry: 0,
  }
  let lastStateChangeRaw: number | undefined

  // Retry tracking
  let retryRaw: { message: string; next: number } | undefined
  let retryCountRaw = 0

  // Auto-recovery tracking
  let recoveryTriggeredRaw = false
  let recoveryCountRaw = 0
  let lastResetTimeRaw = Date.now() // Track when last reset/recovery occurred

  // Last user message for re-issue
  let lastUserMessageRaw: { text: string; parts: any[] } | undefined

  // Reactive store
  const [telemetry, setTelemetry] = createStore({
    busy: false,
    activity: "idle" as ActivityType,
    activityDuration: 0,
    activeTool: undefined as string | undefined,
    activeToolDisplay: undefined as string | undefined, // argv[0] for bash
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
    // Mode (LOCKED or ARMED with timeout)
    modeLabel: "ARMED 30s",
    modeMs: 30_000 as number | undefined,
    isLocked: false,
    recoveryCountdown: 0, // ms until auto-recovery
    recoveryCount: 0,
    timeSinceReset: 0, // ms since last reset
    // FSM state machine
    fsmState: "idle" as FSMState,
    fsmTrail: [] as { state: FSMState; symbol: string; tool?: string }[],
    fsmDepth: 0,
    fsmLoops: 0,
    fsmToolCount: 0,
    fsmToolDuration: 0,
    // Cost tracking
    sessionCost: 0,
    turnCost: 0,
    costRate: 0, // $/min
    // State time distribution (for histogram)
    stateTime: { idle: 0, think: 0, stream: 0, tool: 0, wait: 0, stall: 0, retry: 0 } as Record<FSMState, number>,
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
    lastResetTimeRaw = Date.now() // Reset the clock

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
    await sdk.client.session
      .revert({
        sessionID,
        messageID: lastUserMsg.id,
      })
      .catch(() => {})

    // Get current model
    const model = local.model.current()
    if (!model) {
      recoveryTriggeredRaw = false
      return
    }

    // Re-issue the prompt - only include valid input part types
    const validInputTypes = ["file", "agent", "subtask"] as const
    const nonTextParts = parts.filter((p): p is (typeof parts)[number] & { type: "file" | "agent" | "subtask" } =>
      validInputTypes.includes(p.type as (typeof validInputTypes)[number]),
    )
    await sdk.client.session
      .prompt({
        sessionID,
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
            ...p,
            id: `part_${Date.now()}_${i}`,
          })),
        ],
      })
      .catch(() => {})

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

    const silenceDuration = lastByteTimeRaw ? now - lastByteTimeRaw : startTimeRaw ? now - startTimeRaw : 0

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

    // Calculate recovery countdown (only in ARMED mode)
    const mode = currentMode()
    let recoveryCountdown = 0
    if (mode.ms !== undefined && busyRaw && !isToolRunning && silenceDuration > 2000) {
      recoveryCountdown = Math.max(0, mode.ms - silenceDuration)

      // Trigger recovery if countdown reached zero
      if (recoveryCountdown <= 0 && !recoveryTriggeredRaw) {
        triggerRecovery()
      }
    }

    // Update FSM state based on current activity
    if (stalled && fsmStateRaw !== "stall") {
      transitionFSM("stall")
    } else if (retryRaw && fsmStateRaw !== "retry") {
      transitionFSM("retry")
    }

    // Build FSM trail (last 8 transitions)
    const trail = fsmTransitionsRaw.slice(-8).map((t) => ({
      state: t.to,
      symbol: STATE_SYMBOLS[t.to],
      tool: t.tool,
    }))

    // Calculate cost rate ($ per minute)
    const turnElapsed = turnStartTimeRaw ? now - turnStartTimeRaw : 0
    const costRate = turnElapsed > 10000 ? (lastTurnCostRaw / turnElapsed) * 60000 : 0

    // Calculate current tool duration
    const toolDuration = fsmLastToolStartRaw && activityRaw === "tool" ? now - fsmLastToolStartRaw : 0

    // Get display name for active tool (argv[0] for bash)
    let activeToolDisplay = lastToolRaw
    if (lastToolRaw === "bash" && lastToolArgsRaw) {
      activeToolDisplay = argv0(lastToolArgsRaw)
    }

    setTelemetry({
      busy: busyRaw,
      activity: activityRaw,
      activityDuration,
      activeTool: activityRaw === "tool" ? lastToolRaw : undefined,
      activeToolDisplay: activityRaw === "tool" ? activeToolDisplay : undefined,
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
      modeLabel: mode.label,
      modeMs: mode.ms,
      isLocked: mode.mode === "locked",
      recoveryCountdown,
      recoveryCount: recoveryCountRaw,
      timeSinceReset: now - lastResetTimeRaw,
      // FSM state machine
      fsmState: fsmStateRaw,
      fsmTrail: trail,
      fsmDepth: fsmDepthRaw,
      fsmLoops: fsmLoopCountRaw,
      fsmToolCount: fsmToolCountRaw,
      fsmToolDuration: toolDuration,
      // Cost tracking
      sessionCost: sessionCostRaw,
      turnCost: lastTurnCostRaw,
      costRate,
      // State time distribution
      stateTime: { ...stateTimeRaw },
    })
  }

  function setActivity(type: ActivityType, tool?: string, toolArgs?: string) {
    if (activityRaw !== type || (type === "tool" && tool !== lastToolRaw)) {
      lastActivityRaw = activityRaw
      activityRaw = type
      activityStartRaw = Date.now()
      if (tool) lastToolRaw = tool
      if (toolArgs !== undefined) lastToolArgsRaw = toolArgs
    }
  }

  // Transition FSM state with tracking
  function transitionFSM(to: FSMState, tool?: string) {
    const now = Date.now()
    const from = fsmStateRaw

    // Track time in previous state
    if (lastStateChangeRaw !== undefined) {
      stateTimeRaw[from] += now - lastStateChangeRaw
    }
    lastStateChangeRaw = now

    // Record transition
    if (from !== to || (to === "tool" && tool)) {
      fsmTransitionsRaw.push({ from, to, time: now, tool })
      // Keep last 20 transitions
      if (fsmTransitionsRaw.length > 20) fsmTransitionsRaw.shift()
    }

    // Track loops: tool→wait→tool pattern
    if (to === "tool" && from === "wait") {
      fsmLoopCountRaw++
    }

    // Track depth: entering tool increments, leaving decrements
    if (to === "tool") {
      fsmDepthRaw++
      fsmToolCountRaw++
      fsmLastToolStartRaw = now
    } else if (from === "tool") {
      fsmDepthRaw = Math.max(0, fsmDepthRaw - 1)
    }

    fsmStateRaw = to
  }

  // Tab to cycle mode (LOCKED / ARMED with timeouts)
  useKeyboard((evt) => {
    if (!keybind.match("stall_timeout_cycle", evt)) return
    if (route.data.type !== "session") return

    const current = getModeIndex()
    const next = (current + 1) % MODE_OPTIONS.length
    setModeIndex(next)

    // Switch agent based on mode
    const mode = MODE_OPTIONS[next]
    local.agent.set(mode.mode)

    // Force refresh to show new mode immediately
    refreshTelemetry()
  })

  // Track text streaming deltas
  sdk.event.on("message.part.updated", (evt) => {
    const part = evt.properties.part
    if (part.sessionID !== currentSessionID()) return

    if (part.type === "tool") {
      if (part.state.status === "running") {
        // Extract command args for bash tools
        const toolArgs =
          part.tool === "bash" && part.state.input?.command ? String(part.state.input.command) : undefined
        setActivity("tool", part.tool, toolArgs)
        transitionFSM("tool", part.tool === "bash" && toolArgs ? argv0(toolArgs) : part.tool)
      } else if (part.state.status === "completed" || part.state.status === "error") {
        if (lastToolRaw === part.tool) {
          setActivity("waiting")
          transitionFSM("wait")
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
      // Transition FSM
      if (part.type === "reasoning") {
        transitionFSM("think")
      } else {
        transitionFSM("stream")
      }
    }
  })

  // Track session status
  sdk.event.on("session.status", (evt) => {
    if (evt.properties.sessionID !== currentSessionID()) return
    const status = evt.properties.status
    if (status.type === "busy") {
      if (!busyRaw) {
        startTimeRaw = Date.now()
        turnStartTimeRaw = Date.now()
        totalBytesRaw = 0
        samplesRaw = []
        lastToolRaw = undefined
        lastToolArgsRaw = undefined
        lastByteTimeRaw = undefined
        retryCountRaw = 0
        recoveryTriggeredRaw = false
        // Reset FSM for new turn
        fsmTransitionsRaw = []
        fsmDepthRaw = 0
        fsmLoopCountRaw = 0
        fsmToolCountRaw = 0
        fsmLastToolStartRaw = undefined
        lastTurnCostRaw = 0
        stateTimeRaw = { idle: 0, think: 0, stream: 0, tool: 0, wait: 0, stall: 0, retry: 0 }
        lastStateChangeRaw = Date.now()
        setActivity("waiting")
        transitionFSM("wait")
      }
      busyRaw = true
      retryRaw = undefined
    } else if (status.type === "idle") {
      busyRaw = false
      retryRaw = undefined
      setActivity("idle")
      transitionFSM("idle")
    } else if (status.type === "retry") {
      retryRaw = { message: status.message, next: status.next }
      retryCountRaw++
      setActivity("waiting")
      transitionFSM("retry")
    }
  })

  // Track costs from assistant messages
  sdk.event.on("message.updated", (evt) => {
    const msg = evt.properties.info
    if (msg.sessionID !== currentSessionID()) return
    if (msg.role === "assistant") {
      lastTurnCostRaw = msg.cost
      sessionCostRaw = messages()
        .filter((m) => m.role === "assistant")
        .reduce((sum, m) => sum + m.cost, 0)
    }
  })

  // Get messages for cost calculation
  const messages = createMemo(() => sync.data.message[currentSessionID()] ?? [])

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

  // Stable display values - always show something in each cell
  const stateDisplay = createMemo(() => {
    const state = telemetry.fsmState
    const symbol = STATE_SYMBOLS[state]
    const tool = telemetry.activeToolDisplay

    if (state === "tool" && tool) return { symbol, label: tool, color: theme.primary }
    if (state === "stream") return { symbol, label: "stream", color: theme.success }
    if (state === "think") return { symbol, label: "think", color: theme.info }
    if (state === "stall") return { symbol: "!", label: telemetry.stallReason || "stall", color: theme.error }
    if (state === "retry") return { symbol: "~", label: "retry", color: theme.warning }
    if (state === "wait") return { symbol, label: "wait", color: theme.textMuted }
    return { symbol, label: "idle", color: theme.textMuted }
  })

  // Elapsed time: turn time when busy, time since reset when idle
  const elapsedDisplay = createMemo(() => {
    if (telemetry.busy) return formatElapsed(telemetry.elapsed)
    return formatElapsed(telemetry.timeSinceReset)
  })

  // Cost display: turn cost when busy, session cost when idle
  const costDisplay = createMemo(() => {
    if (telemetry.busy && telemetry.turnCost > 0) return formatCost(telemetry.turnCost)
    if (telemetry.sessionCost > 0) return formatCost(telemetry.sessionCost)
    return "$0.00"
  })

  // Rate display
  const rateDisplay = createMemo(() => {
    if (!telemetry.busy) return "0/s"
    return `${formatRate(telemetry.r1)}/s`
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={2} flexShrink={0}>
      {/* Left side: stable cells */}
      <box flexDirection="row" gap={3}>
        {/* State */}
        <text fg={stateDisplay().color}>
          {stateDisplay().symbol} {stateDisplay().label}
        </text>
        {/* Project:branch */}
        <text fg={theme.text}>{directory().split("/").at(-1)}</text>
        {/* Cost */}
        <text fg={theme.textMuted}>{costDisplay()}</text>
        {/* Mode */}
        <text fg={telemetry.isLocked ? theme.warning : theme.textMuted}>{telemetry.modeLabel}</text>
        {/* Elapsed */}
        <text fg={theme.text}>{elapsedDisplay()}</text>
        {/* Rate */}
        <text fg={theme.success}>{rateDisplay()}</text>
        {/* Trend sparkline (only when busy) */}
        <Show when={telemetry.busy && telemetry.trend}>
          <text fg={theme.success}>{telemetry.trend}</text>
        </Show>
      </box>
      {/* Right side */}
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.textMuted }}>/connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>! {permissions().length}</text>
            </Show>
            <text fg={theme.text}>
              <span style={{ fg: lsp().length > 0 ? theme.success : theme.textMuted }}>.</span> {lsp().length} LSP
            </text>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
