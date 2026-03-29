import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useToast } from "@tui/ui/toast"
import { useRoute } from "@tui/context/route"
import type { Plan, WorkerState, Subtask } from "@/parallel/schema"
import { summarizeWaves } from "@/parallel/scheduler"
import { selectExecutionMode } from "@/parallel/strategy"
import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { pipe, sumBy } from "remeda"

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}m ${secs}s`
}

function formatCost(cost: number) {
  if (cost === 0) return "$0.00"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(cost)
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatTime(ts: number) {
  const date = new Date(ts)
  return date.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function waveLabel(index: number, type: "parallel" | "serial") {
  return `${type === "parallel" ? "P" : "S"}${index + 1}`
}

function statusRank(status: WorkerState["status"]) {
  switch (status) {
    case "running":
      return 0
    case "spawning":
      return 1
    case "failed":
    case "conflict":
      return 2
    case "pending":
      return 3
    case "stopping":
      return 4
    case "done":
      return 5
    case "merged":
      return 6
  }
}

function statusLabel(worker: WorkerState) {
  if ((worker.status === "merged" || worker.status === "conflict") && worker.resolutionMode) {
    return `${worker.status} (${worker.resolutionMode})`
  }
  return worker.status
}

function statusIcon(status: WorkerState["status"]) {
  switch (status) {
    case "pending":
      return "○"
    case "spawning":
      return "◐"
    case "running":
      return "●"
    case "done":
    case "merged":
      return "✓"
    case "failed":
    case "conflict":
      return "✗"
    default:
      return "○"
  }
}

function WorkerLane(props: {
  worker: WorkerState
  subtask: Subtask | undefined
  selected: boolean
  planWorkerModel: string
  onSelect: () => void
}) {
  const { theme } = useTheme()
  const sync = useSync()

  const messages = createMemo(() => {
    if (!props.worker.sessionID) return []
    return sync.data.message[props.worker.sessionID] ?? []
  })

  const cost = createMemo(() =>
    pipe(
      messages(),
      sumBy((msg) => (msg.role === "assistant" ? msg.cost : 0)),
    ),
  )

  const stats = createMemo(() => {
    let tools = 0
    let inputTokens = 0
    let outputTokens = 0
    for (const msg of messages()) {
      if (msg.role !== "assistant") continue
      inputTokens += msg.tokens?.input ?? 0
      outputTokens += msg.tokens?.output ?? 0
      const parts = sync.data.part[msg.id] ?? []
      tools += parts.filter((part) => part.type === "tool").length
    }
    return { tools, inputTokens, outputTokens }
  })

  const activity = createMemo(() => {
    const msgs = messages()
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (msg.role !== "assistant") continue
      const parts = sync.data.part[msg.id] ?? []
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j]
        if (part.type === "tool" && part.state.status === "running") return `Running ${part.tool}`
        if (part.type === "tool" && part.state.status === "pending") return `Pending ${part.tool}`
        if (part.type === "text" && part.text) return part.text.slice(0, 60).replace(/\n/g, " ")
      }
    }
    if (props.worker.status === "running") return "Thinking..."
    return ""
  })

  const tone = () => {
    switch (props.worker.status) {
      case "running":
        return theme.warning
      case "done":
      case "merged":
        return theme.success
      case "failed":
      case "conflict":
        return theme.error
      case "spawning":
        return theme.accent
      default:
        return theme.textMuted
    }
  }

  const model = () => props.subtask?.model?.modelID ?? props.planWorkerModel

  return (
    <box
      flexDirection="column"
      backgroundColor={props.selected ? theme.backgroundElement : theme.background}
      padding={1}
      borderStyle="rounded"
      borderColor={tone()}
      onMouseUp={props.onSelect}
    >
      <box flexDirection="row" gap={1}>
        <text fg={tone()}>{statusIcon(props.worker.status)}</text>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.subtask?.title?.slice(0, 28) ?? "Unknown"}
        </text>
      </box>

      <text fg={tone()}>{statusLabel(props.worker)}</text>

      <Show when={activity()}>
        <text fg={theme.accent} wrapMode="word">
          {activity()}
        </text>
      </Show>

      <box flexDirection="row" gap={1} marginTop={1}>
        <text fg={theme.textMuted}>{stats().tools} tools</text>
        <text fg={theme.accent}>{formatCost(cost())}</text>
        <text fg={theme.textMuted}>[{model()}]</text>
      </box>

      <Show when={stats().inputTokens > 0 || stats().outputTokens > 0}>
        <text fg={theme.textMuted}>
          {formatTokens(stats().inputTokens)} in / {formatTokens(stats().outputTokens)} out
        </text>
      </Show>

      <Show when={props.worker.diffStat}>
        <text fg={theme.success}>
          +{props.worker.diffStat!.additions} -{props.worker.diffStat!.deletions} ({props.worker.diffStat!.files} files)
        </text>
      </Show>

      <Show when={props.worker.error}>
        <text fg={theme.error} wrapMode="word">
          {props.worker.error!.slice(0, 80)}
        </text>
      </Show>
    </box>
  )
}

function Action(props: { label: string; onMouseUp: () => void; tone?: "primary" | "accent" | "warning" | "error" }) {
  const { theme } = useTheme()
  const bg = () => {
    switch (props.tone) {
      case "primary":
        return theme.primary
      case "accent":
        return theme.accent
      case "warning":
        return theme.warning
      case "error":
        return theme.error
      default:
        return theme.backgroundElement
    }
  }

  return (
    <box backgroundColor={bg()} paddingX={1} onMouseUp={props.onMouseUp}>
      <text fg={theme.background}>{props.label}</text>
    </box>
  )
}

function WorkerDetail(props: {
  plan: Plan
  worker: WorkerState
  subtask: Subtask | undefined
  width: number
  onLogs: () => void
  onOpen: () => void
  onRetry: () => void
}) {
  const { theme } = useTheme()
  const sync = useSync()

  const messages = createMemo(() => {
    if (!props.worker.sessionID) return []
    return sync.data.message[props.worker.sessionID] ?? []
  })

  const sessionStatus = createMemo(() => {
    if (!props.worker.sessionID) return undefined
    return sync.data.session_status[props.worker.sessionID]
  })

  const stats = createMemo(() => {
    let cost = 0
    let inputTokens = 0
    let outputTokens = 0
    let tools = 0
    const recent = [] as { name: string; status: string; duration?: number }[]

    for (const msg of messages()) {
      if (msg.role !== "assistant") continue
      cost += msg.cost ?? 0
      inputTokens += msg.tokens?.input ?? 0
      outputTokens += msg.tokens?.output ?? 0
      const parts = sync.data.part[msg.id] ?? []
      for (const part of parts) {
        if (part.type !== "tool") continue
        tools += 1
        const duration =
          part.state.status === "completed" && part.state.time?.start && part.state.time?.end
            ? part.state.time.end - part.state.time.start
            : undefined
        recent.push({ name: part.tool, status: part.state.status, duration })
      }
    }

    return { cost, inputTokens, outputTokens, tools, recent: recent.slice(-10) }
  })

  const activity = createMemo(() => {
    const msgs = messages()
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (msg.role !== "assistant") continue
      const parts = sync.data.part[msg.id] ?? []
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j]
        if (part.type === "tool" && part.state.status === "running") return `Running ${part.tool}`
        if (part.type === "tool" && part.state.status === "pending") return `Pending ${part.tool}`
        if (part.type === "text" && part.text) return part.text.slice(0, 180).replace(/\n/g, " ")
      }
    }
    if (props.worker.status === "running") return "Thinking..."
    return "Idle"
  })

  const deps = createMemo(() =>
    (props.subtask?.dependencies ?? [])
      .map((id) => props.plan.subtasks.find((item) => item.id === id)?.title)
      .filter((item): item is string => !!item),
  )

  const consumers = createMemo(() =>
    props.plan.subtasks
      .filter((item) => item.dependencies.includes(props.worker.subtaskID))
      .map((item) => item.title),
  )

  const model = () => props.subtask?.model?.modelID ?? props.plan.workerModel.modelID

  return (
    <box
      flexDirection="column"
      width={props.width}
      backgroundColor={theme.background}
      borderStyle="rounded"
      borderColor={theme.border}
      padding={1}
      gap={1}
    >
      <box flexDirection="row" gap={1}>
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          Worker Details
        </text>
        <text fg={theme.text}>{props.subtask?.title ?? "Unknown"}</text>
      </box>

      <box flexDirection="row" gap={1}>
        <Action label="open session" tone="primary" onMouseUp={props.onOpen} />
        <Action label="logs" tone="accent" onMouseUp={props.onLogs} />
        <Show when={props.worker.status === "failed"}>
          <Action label="retry" tone="warning" onMouseUp={props.onRetry} />
        </Show>
      </box>

      <box flexDirection="column">
        <text fg={theme.textMuted}>status</text>
        <text fg={theme.text}>{statusLabel(props.worker)}</text>
      </box>

      <box flexDirection="column">
        <text fg={theme.textMuted}>activity</text>
        <text fg={theme.accent} wrapMode="word">
          {activity()}
        </text>
      </box>

      <box flexDirection="row" gap={2}>
        <text fg={theme.textMuted}>model</text>
        <text fg={theme.text}>{model()}</text>
        <text fg={theme.textMuted}>session</text>
        <text fg={theme.text}>{sessionStatus()?.type ?? "n/a"}</text>
      </box>

      <box flexDirection="row" gap={2}>
        <text fg={theme.textMuted}>cost</text>
        <text fg={theme.accent}>{formatCost(stats().cost)}</text>
        <text fg={theme.textMuted}>
          {formatTokens(stats().inputTokens)} in / {formatTokens(stats().outputTokens)} out
        </text>
      </box>

      <box flexDirection="row" gap={2}>
        <text fg={theme.textMuted}>tools</text>
        <text fg={theme.text}>{stats().tools}</text>
        <Show when={props.worker.diffStat}>
          <text fg={theme.success}>
            +{props.worker.diffStat!.additions} -{props.worker.diffStat!.deletions} ({props.worker.diffStat!.files} files)
          </text>
        </Show>
      </box>

      <Show when={props.worker.branch}>
        <box flexDirection="column">
          <text fg={theme.textMuted}>branch</text>
          <text fg={theme.text} wrapMode="word">
            {props.worker.branch}
          </text>
        </box>
      </Show>

      <Show when={props.worker.worktreeDir}>
        <box flexDirection="column">
          <text fg={theme.textMuted}>worktree</text>
          <text fg={theme.text} wrapMode="word">
            {props.worker.worktreeDir}
          </text>
        </box>
      </Show>

      <Show when={props.subtask?.description}>
        <box flexDirection="column">
          <text fg={theme.textMuted}>summary</text>
          <text fg={theme.text} wrapMode="word">
            {props.subtask!.description}
          </text>
        </box>
      </Show>

      <Show when={(props.subtask?.fileScope.length ?? 0) > 0}>
        <box flexDirection="column">
          <text fg={theme.textMuted}>file scope</text>
          <For each={props.subtask?.fileScope ?? []}>
            {(item) => (
              <text fg={theme.text} wrapMode="word">
                {item}
              </text>
            )}
          </For>
        </box>
      </Show>

      <Show when={deps().length > 0}>
        <box flexDirection="column">
          <text fg={theme.textMuted}>depends on</text>
          <For each={deps()}>{(item) => <text fg={theme.text}>{item}</text>}</For>
        </box>
      </Show>

      <Show when={consumers().length > 0}>
        <box flexDirection="column">
          <text fg={theme.textMuted}>unblocks</text>
          <For each={consumers()}>{(item) => <text fg={theme.text}>{item}</text>}</For>
        </box>
      </Show>

      <Show when={(props.subtask?.constraints?.length ?? 0) > 0}>
        <box flexDirection="column">
          <text fg={theme.textMuted}>constraints</text>
          <For each={props.subtask?.constraints ?? []}>{(item) => <text fg={theme.warning}>{item}</text>}</For>
        </box>
      </Show>

      <Show when={props.worker.error}>
        <box flexDirection="column">
          <text fg={theme.textMuted}>error</text>
          <text fg={theme.error} wrapMode="word">
            {props.worker.error!}
          </text>
        </box>
      </Show>

      <Show when={stats().recent.length > 0}>
        <box flexDirection="column" borderStyle="single" borderColor={theme.border} paddingTop={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.UNDERLINE}>
            Recent tools
          </text>
          <For each={stats().recent}>
            {(tool) => (
              <box flexDirection="row" gap={1}>
                <text fg={theme.text}>{tool.name}</text>
                <text fg={theme.textMuted}>{tool.status}</text>
                <Show when={tool.duration}>
                  <text fg={theme.textMuted}>{formatDuration(tool.duration!)}</text>
                </Show>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

function WorkerLogs(props: { worker: WorkerState; subtask: Subtask | undefined; width: number }) {
  const { theme } = useTheme()
  const sync = useSync()

  const messages = createMemo(() => {
    if (!props.worker.sessionID) return []
    return sync.data.message[props.worker.sessionID] ?? []
  })

  const rows = createMemo(() => {
    const out = [] as { role: string; preview: string; time: string }[]
    for (const msg of messages()) {
      const parts = sync.data.part[msg.id] ?? []
      let preview = ""
      if (msg.role === "user") {
        preview = parts.find((part) => part.type === "text")?.text?.slice(0, 120) ?? "User message"
      } else {
        for (const part of parts) {
          if (part.type === "text" && part.text) {
            preview = part.text.slice(0, 120)
            break
          }
          if (part.type === "tool") {
            preview = `[${part.tool}] ${part.state.status}`
            break
          }
        }
        if (!preview) preview = "Assistant response"
      }
      out.push({
        role: msg.role,
        preview: preview.replace(/\n/g, " "),
        time: formatTime(msg.time.created),
      })
    }
    return out.slice(-20)
  })

  return (
    <box
      flexDirection="column"
      width={props.width}
      backgroundColor={theme.background}
      borderStyle="rounded"
      borderColor={theme.border}
      padding={1}
      gap={1}
    >
      <box flexDirection="row" gap={1}>
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          Logs
        </text>
        <text fg={theme.text}>{props.subtask?.title ?? "Unknown"}</text>
        <text fg={theme.textMuted}>({messages().length} messages)</text>
      </box>
      <For each={rows()}>
        {(row) => (
          <box flexDirection="row" gap={1}>
            <text fg={theme.textMuted}>{row.time}</text>
            <text fg={row.role === "user" ? theme.accent : theme.success}>{row.role === "user" ? "U" : "A"}</text>
            <text fg={theme.text} wrapMode="word">
              {row.preview.slice(0, Math.max(40, props.width - 18))}
            </text>
          </box>
        )}
      </For>
      <Show when={rows().length === 0}>
        <text fg={theme.textMuted}>No messages yet</text>
      </Show>
    </box>
  )
}

export function ParallelStatus(props: { plan: Plan; onCancelled?: () => void; onBack?: () => void }) {
  const { theme } = useTheme()
  const dim = useTerminalDimensions()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const route = useRoute()
  const [selected, setSelected] = createSignal(0)
  const [showLogs, setShowLogs] = createSignal(false)
  const [elapsed, setElapsed] = createSignal(0)
  const [view, setView] = createSignal<"active" | "all" | "failed" | "done">("active")
  const [sort, setSort] = createSignal<"status" | "title" | "cost">("status")
  let scroll: ScrollBoxRenderable | undefined

  const workerSessions = createMemo(() =>
    props.plan.workers.flatMap((worker) => (worker.sessionID ? [worker.sessionID] : [])),
  )

  const startTime = props.plan.time.approved ?? props.plan.time.created
  createEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Date.now() - startTime)
    }, 1000)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    for (const sessionID of workerSessions()) {
      void sync.session.sync(sessionID).catch(() => {})
    }
  })

  const running = () => props.plan.workers.filter((worker) => worker.status === "running").length
  const done = () => props.plan.workers.filter((worker) => worker.status === "done" || worker.status === "merged").length
  const failed = () => props.plan.workers.filter((worker) => worker.status === "failed" || worker.status === "conflict").length
  const total = () => props.plan.workers.length
  const width = () => Math.min(120, dim().width - 2)
  const height = () => Math.max(12, dim().height - 4)
  const wide = () => width() >= 110
  const listWidth = () => (wide() ? Math.min(44, Math.floor(width() * 0.4)) : width())
  const detailWidth = () => (wide() ? width() - listWidth() - 1 : width())

  const waves = createMemo(() => {
    if (props.plan.subtasks.length === 0) return null
    return summarizeWaves(props.plan.subtasks, props.plan.workers)
  })
  const currentWave = createMemo(() => waves()?.current)
  const wiring = createMemo(() => props.plan.subtasks.find((item) => item.title === "Final wiring (shared files)"))

  const totals = createMemo(() => {
    let cost = 0
    let input = 0
    let output = 0
    let tools = 0
    for (const worker of props.plan.workers) {
      if (!worker.sessionID) continue
      const msgs = sync.data.message[worker.sessionID] ?? []
      for (const msg of msgs) {
        if (msg.role !== "assistant") continue
        cost += msg.cost ?? 0
        input += msg.tokens?.input ?? 0
        output += msg.tokens?.output ?? 0
        const parts = sync.data.part[msg.id] ?? []
        tools += parts.filter((part) => part.type === "tool").length
      }
    }
    return { cost, input, output, tools }
  })

  const timeline = createMemo(() => {
    const items: { time: number; text: string; tone: "muted" | "accent" | "success" | "warning" }[] = [
      { time: props.plan.time.created, text: "Plan created", tone: "muted" },
    ]

    if (props.plan.time.approved) {
      items.push({ time: props.plan.time.approved, text: "Plan approved", tone: "accent" })
    }

    if (props.plan.time.completed) {
      items.push({
        time: props.plan.time.completed,
        text: `Plan ${props.plan.status}`,
        tone: props.plan.status === "done" ? "success" : "warning",
      })
    }

    for (const worker of props.plan.workers) {
      if (!worker.sessionID) continue
      const msgs = sync.data.message[worker.sessionID] ?? []
      const subtask = props.plan.subtasks.find((item) => item.id === worker.subtaskID)
      const title = subtask?.title ?? String(worker.subtaskID).slice(0, 8)
      const user = msgs.find((msg) => msg.role === "user")
      if (user) items.push({ time: user.time.created, text: `Prompt sent: ${title}`, tone: "accent" })
      const assistant = msgs.find((msg) => msg.role === "assistant")
      if (assistant) items.push({ time: assistant.time.created, text: `Worker active: ${title}`, tone: "success" })
    }

    return items.toSorted((a, b) => b.time - a.time).slice(0, 8)
  })

  const costOf = (worker: WorkerState) =>
    pipe(
      worker.sessionID ? (sync.data.message[worker.sessionID] ?? []) : [],
      sumBy((msg) => (msg.role === "assistant" ? msg.cost : 0)),
    )

  const items = createMemo(() =>
    props.plan.workers
      .map((worker, index) => ({
        index,
        worker,
        subtask: props.plan.subtasks.find((item) => item.id === worker.subtaskID),
        cost: costOf(worker),
      }))
      .filter((item) => {
        const mode = view()
        if (mode === "all") return true
        if (mode === "failed") return item.worker.status === "failed" || item.worker.status === "conflict"
        if (mode === "done") return item.worker.status === "done" || item.worker.status === "merged"
        return item.worker.status !== "done" && item.worker.status !== "merged"
      })
      .toSorted((a, b) => {
        if (sort() === "title") return (a.subtask?.title ?? "").localeCompare(b.subtask?.title ?? "")
        if (sort() === "cost") return b.cost - a.cost
        return statusRank(a.worker.status) - statusRank(b.worker.status)
      }),
  )

  createEffect(() => {
    const max = Math.max(0, items().length - 1)
    if (selected() > max) setSelected(max)
  })

  const current = createMemo(() => items()[selected()])

  const nextView = () => {
    const list = ["active", "all", "failed", "done"] as const
    const index = list.indexOf(view())
    setView(list[(index + 1) % list.length])
    setSelected(0)
    setShowLogs(false)
  }

  const nextSort = () => {
    const list = ["status", "title", "cost"] as const
    const index = list.indexOf(sort())
    setSort(list[(index + 1) % list.length])
    setSelected(0)
  }

  const openCurrent = () => {
    const item = current()
    if (!item?.worker.sessionID) {
      toast.show({ message: "Selected worker has no session yet", variant: "info" })
      return
    }
    route.navigate({ type: "session", sessionID: item.worker.sessionID })
  }

  const retryCurrent = async () => {
    const item = current()
    if (!item) return
    if (item.worker.status !== "failed") {
      toast.show({ message: "Only failed workers can be retried", variant: "info" })
      return
    }
    try {
      const { Orchestrator } = await import("@/parallel/orchestrator")
      await Orchestrator.retryWorker({ planID: props.plan.id, subtaskID: item.worker.subtaskID })
      toast.show({ message: "Worker retry started", variant: "info" })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to retry worker")
    }
  }

  const handleCancel = () => {
    dialog.replace(() => (
      <DialogSelect
        title="Cancel Running Plan?"
        options={[
          {
            title: "Yes, cancel all",
            value: "confirm",
            description: "Abort all workers and cancel the plan",
            onSelect: async () => {
              try {
                const { Orchestrator } = await import("@/parallel/orchestrator")
                await Orchestrator.cancel(props.plan.id)
                dialog.clear()
                toast.show({ message: "Plan cancelled", variant: "info" })
                props.onCancelled?.()
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed to cancel plan")
              }
            },
          },
          {
            title: "No, continue",
            value: "abort",
            description: "Keep the plan running",
            onSelect: () => dialog.clear(),
          },
        ]}
      />
    ))
  }

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return
    if (evt.defaultPrevented) return
    if (evt.name === "up" || evt.sequence === "k") {
      if (items().length === 0) return
      evt.preventDefault()
      evt.stopPropagation()
      setSelected((value) => Math.max(0, value - 1))
      return
    }
    if (evt.name === "down" || evt.sequence === "j") {
      if (items().length === 0) return
      evt.preventDefault()
      evt.stopPropagation()
      setSelected((value) => Math.min(items().length - 1, value + 1))
      return
    }
    if (evt.name === "pageup") {
      evt.preventDefault()
      evt.stopPropagation()
      scroll?.scrollBy(-Math.max(1, Math.floor(height() / 2)))
      return
    }
    if (evt.name === "pagedown") {
      evt.preventDefault()
      evt.stopPropagation()
      scroll?.scrollBy(Math.max(1, Math.floor(height() / 2)))
      return
    }
    if (evt.name === "home") {
      evt.preventDefault()
      evt.stopPropagation()
      scroll?.scrollTo(0)
      return
    }
    if (evt.name === "end") {
      evt.preventDefault()
      evt.stopPropagation()
      scroll?.scrollTo(scroll.scrollHeight)
      return
    }
    if (evt.name === "escape") {
      evt.preventDefault()
      evt.stopPropagation()
      if (showLogs()) {
        setShowLogs(false)
        return
      }
      props.onBack?.()
      return
    }
    if (evt.name === "l" || (evt.sequence === "l" && !evt.ctrl)) {
      evt.preventDefault()
      evt.stopPropagation()
      setShowLogs((value) => !value)
      return
    }
    if (evt.name === "o" || (evt.sequence === "o" && !evt.ctrl)) {
      evt.preventDefault()
      evt.stopPropagation()
      openCurrent()
      return
    }
    if (evt.name === "r" || (evt.sequence === "r" && !evt.ctrl)) {
      evt.preventDefault()
      evt.stopPropagation()
      void retryCurrent()
      return
    }
    if (evt.name === "f" || (evt.sequence === "f" && !evt.ctrl)) {
      evt.preventDefault()
      evt.stopPropagation()
      nextView()
      return
    }
    if (evt.name === "s" || (evt.sequence === "s" && !evt.ctrl)) {
      evt.preventDefault()
      evt.stopPropagation()
      nextSort()
      return
    }
    if (evt.name === "c" || (evt.sequence === "c" && !evt.ctrl)) {
      evt.preventDefault()
      evt.stopPropagation()
      handleCancel()
    }
  })

  return (
    <box width={width()} height={height()} backgroundColor={theme.backgroundPanel} padding={1}>
      <scrollbox
        ref={(item) => (scroll = item)}
        height="100%"
        width="100%"
        verticalScrollbarOptions={{
          paddingLeft: 1,
          trackOptions: {
            backgroundColor: theme.backgroundElement,
            foregroundColor: theme.border,
          },
        }}
      >
        <box flexDirection="column" width={width() - 2}>
          <box flexDirection="row" gap={2} marginBottom={1}>
            <text attributes={TextAttributes.BOLD} fg={theme.primary}>
              Agent Manager
            </text>
            <text fg={theme.text}>
              {done()}/{total()} complete
            </text>
            <Show when={running() > 0}>
              <text fg={theme.warning}>{running()} running</text>
            </Show>
            <Show when={failed() > 0}>
              <text fg={theme.error}>{failed()} failed</text>
            </Show>
            <text fg={theme.textMuted}>{formatDuration(elapsed())}</text>
          </box>

          <box flexDirection="row" gap={2} marginBottom={1}>
            <text fg={theme.textMuted}>view</text>
            <text fg={theme.accent}>{view()}</text>
            <text fg={theme.textMuted}>sort</text>
            <text fg={theme.accent}>{sort()}</text>
            <text fg={theme.textMuted}>mode</text>
            <text fg={selectExecutionMode(props.plan) === "task-agent" ? theme.accent : theme.success}>
              {selectExecutionMode(props.plan)}
            </text>
            <text fg={theme.textMuted}>
              showing {items().length} of {total()}
            </text>
          </box>

          <Show when={currentWave()}>
            <box flexDirection="row" gap={2} marginBottom={1}>
              <text fg={theme.textMuted}>Current:</text>
              <text fg={theme.accent}>
                {waveLabel(currentWave()!.index, currentWave()!.type)} {currentWave()!.state}
              </text>
              <Show when={waves()!.ready > 0}>
                <text fg={theme.success}>{waves()!.ready} ready</text>
              </Show>
              <Show when={waves()!.waiting > 0}>
                <text fg={theme.textMuted}>{waves()!.waiting} waiting</text>
              </Show>
              <Show when={waves()!.blocked > 0}>
                <text fg={theme.error}>{waves()!.blocked} blocked</text>
              </Show>
              <Show when={wiring()}>
                <text fg={theme.warning}>wiring task queued</text>
              </Show>
            </box>
          </Show>

          <box marginBottom={1}>
            <text fg={theme.success}>{"█".repeat(Math.floor((done() / Math.max(total(), 1)) * 30))}</text>
            <text fg={theme.warning}>{"█".repeat(Math.floor((running() / Math.max(total(), 1)) * 30))}</text>
            <text fg={theme.textMuted}>
              {"░".repeat(Math.max(0, 30 - Math.floor(((done() + running()) / Math.max(total(), 1)) * 30)))}
            </text>
          </box>

          <Show when={waves()}>
            <box flexDirection="row" gap={2} marginBottom={1}>
              <text fg={theme.textMuted}>Waves:</text>
              <For each={waves()?.waves}>
                {(wave) => (
                  <box flexDirection="row" gap={1}>
                    <text fg={wave.type === "parallel" ? theme.success : theme.warning}>
                      {waveLabel(wave.index, wave.type)}({wave.subtasks.length})
                    </text>
                    <text
                      fg={wave.state === "complete" ? theme.success : wave.state === "active" ? theme.accent : theme.textMuted}
                    >
                      {wave.state}
                    </text>
                    <Show when={wave.reason}>
                      <text fg={theme.textMuted}>{wave.reason}</text>
                    </Show>
                  </box>
                )}
              </For>
            </box>
          </Show>

          <Show when={timeline().length > 0}>
            <box marginBottom={1} padding={1} borderStyle="single" borderColor={theme.border} flexDirection="column">
              <text fg={theme.textMuted} attributes={TextAttributes.UNDERLINE}>
                Timeline
              </text>
              <For each={timeline()}>
                {(item) => (
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.textMuted}>{formatTime(item.time)}</text>
                    <text
                      fg={
                        item.tone === "success"
                          ? theme.success
                          : item.tone === "warning"
                            ? theme.warning
                            : item.tone === "accent"
                              ? theme.accent
                              : theme.text
                      }
                    >
                      {item.text.slice(0, width() - 20)}
                    </text>
                  </box>
                )}
              </For>
            </box>
          </Show>

          <box flexDirection={wide() ? "row" : "column"} gap={1}>
            <box flexDirection="column" width={listWidth()} gap={1}>
              <Show
                when={items().length > 0}
                fallback={
                  <box padding={1} borderStyle="rounded" borderColor={theme.border}>
                    <text fg={theme.textMuted}>No workers match the current view.</text>
                  </box>
                }
              >
                <For each={items()}>
                  {(item, index) => (
                    <WorkerLane
                      worker={item.worker}
                      subtask={item.subtask}
                      selected={selected() === index()}
                      planWorkerModel={props.plan.workerModel.modelID}
                      onSelect={() => {
                        setSelected(index())
                        setShowLogs(false)
                      }}
                    />
                  )}
                </For>
              </Show>
            </box>

            <Show when={current()}>
              {(item) => (
                <box flexDirection="column" width={detailWidth()} gap={1}>
                  <WorkerDetail
                    plan={props.plan}
                    worker={item().worker}
                    subtask={item().subtask}
                    width={detailWidth()}
                    onLogs={() => setShowLogs((value) => !value)}
                    onOpen={openCurrent}
                    onRetry={() => void retryCurrent()}
                  />
                  <Show when={showLogs()}>
                    <WorkerLogs worker={item().worker} subtask={item().subtask} width={detailWidth()} />
                  </Show>
                </box>
              )}
            </Show>
          </box>

          <box marginTop={1} paddingTop={1} borderStyle="single" borderColor={theme.border} flexDirection="column" gap={0}>
            <box flexDirection="row" gap={2}>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                Total:
              </text>
              <text fg={theme.accent}>{formatCost(totals().cost)}</text>
              <text fg={theme.textMuted}>
                {formatTokens(totals().input)} in / {formatTokens(totals().output)} out
              </text>
              <text fg={theme.textMuted}>{totals().tools} tool calls</text>
              <text fg={theme.textMuted}>{formatDuration(elapsed())}</text>
            </box>
            <box flexDirection="row" gap={2} marginTop={1}>
              <text fg={theme.textMuted}>
                arrows navigate | pgup/pgdn scroll | home/end jump | f filter | s sort | l logs | o open | r retry | c cancel | esc back
              </text>
            </box>
          </box>
        </box>
      </scrollbox>
    </box>
  )
}
