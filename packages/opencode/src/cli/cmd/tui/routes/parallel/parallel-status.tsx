import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { For, Show, createSignal, createMemo, createEffect } from "solid-js"
import { useSync } from "@tui/context/sync"
import type { Plan, WorkerState, Subtask } from "@/parallel/schema"
import { TextAttributes } from "@opentui/core"
import { pipe, sumBy } from "remeda"

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}m ${secs}s`
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(cost)
}

function WorkerLane(props: {
  worker: WorkerState
  subtask: Subtask | undefined
  selected: boolean
  expanded: boolean
  planWorkerModel: string
}) {
  const { theme } = useTheme()
  const sync = useSync()

  const statusColor = () => {
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

  const statusIcon = () => {
    switch (props.worker.status) {
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

  // Get live session data from sync store
  const messages = createMemo(() => {
    if (!props.worker.sessionID) return []
    return sync.data.message[props.worker.sessionID] ?? []
  })

  const sessionStatus = createMemo(() => {
    if (!props.worker.sessionID) return undefined
    return sync.data.session_status[props.worker.sessionID]
  })

  const cost = createMemo(() => {
    return pipe(
      messages(),
      sumBy((m) => (m.role === "assistant" ? m.cost : 0)),
    )
  })

  const stats = createMemo(() => {
    let tools = 0
    let inputTokens = 0
    let outputTokens = 0
    for (const msg of messages()) {
      if (msg.role !== "assistant") continue
      inputTokens += msg.tokens?.input ?? 0
      outputTokens += msg.tokens?.output ?? 0
      const parts = sync.data.part[msg.id] ?? []
      tools += parts.filter((p) => p.type === "tool").length
    }
    return { tools, inputTokens, outputTokens }
  })

  // Current activity — find the latest running tool
  const currentActivity = createMemo(() => {
    const msgs = messages()
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (msg.role !== "assistant") continue
      const parts = sync.data.part[msg.id] ?? []
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j]
        if (part.type === "tool") {
          if (part.state.status === "running") {
            return `Running: ${part.tool}`
          }
          if (part.state.status === "pending") {
            return `Pending: ${part.tool}`
          }
        }
        if (part.type === "text" && part.text) {
          return part.text.slice(0, 60).replace(/\n/g, " ")
        }
      }
    }
    if (props.worker.status === "running") return "Thinking..."
    return undefined
  })

  // Recent tool history for expanded view
  const recentTools = createMemo(() => {
    const tools: { name: string; status: string; duration?: number }[] = []
    for (const msg of messages()) {
      if (msg.role !== "assistant") continue
      const parts = sync.data.part[msg.id] ?? []
      for (const part of parts) {
        if (part.type === "tool") {
          const duration =
            part.state.status === "completed" && part.state.time?.start && part.state.time?.end
              ? part.state.time.end - part.state.time.start
              : undefined
          tools.push({
            name: part.tool,
            status: part.state.status,
            duration,
          })
        }
      }
    }
    return tools.slice(-8) // last 8 tools
  })

  const modelLabel = () => {
    const subtaskModel = props.subtask?.model
    if (subtaskModel) return subtaskModel.modelID
    return props.planWorkerModel
  }

  return (
    <box
      flexDirection="column"
      backgroundColor={props.selected ? theme.backgroundElement : theme.background}
      padding={1}
      borderStyle="rounded"
      borderColor={statusColor()}
    >
      {/* Header: status icon + title */}
      <box flexDirection="row" gap={1} marginBottom={props.expanded ? 1 : 0}>
        <text fg={statusColor()}>{statusIcon()}</text>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.subtask?.title?.slice(0, 20) ?? "Unknown"}
        </text>
      </box>

      {/* Status line */}
      <text fg={statusColor()}>{props.worker.status}</text>

      {/* Current activity */}
      <Show when={currentActivity()}>
        <text fg={theme.accent} wrapMode="word">
          {currentActivity()!.slice(0, 50)}
        </text>
      </Show>

      {/* Stats row */}
      <box flexDirection="row" gap={1} marginTop={1}>
        <text fg={theme.textMuted}>{stats().tools} tools</text>
        <text fg={theme.accent}>{formatCost(cost())}</text>
      </box>
      <Show when={stats().inputTokens > 0 || stats().outputTokens > 0}>
        <text fg={theme.textMuted}>
          {formatTokens(stats().inputTokens)} in / {formatTokens(stats().outputTokens)} out
        </text>
      </Show>

      {/* Model */}
      <text fg={theme.textMuted}>[{modelLabel()}]</text>

      {/* Error */}
      <Show when={props.worker.error}>
        <text fg={theme.error} wrapMode="word">
          {props.worker.error!.slice(0, 60)}
        </text>
      </Show>

      {/* Diff stats */}
      <Show when={props.worker.diffStat}>
        <text fg={theme.success}>
          +{props.worker.diffStat!.additions} -{props.worker.diffStat!.deletions} ({props.worker.diffStat!.files}{" "}
          files)
        </text>
      </Show>

      {/* Expanded: recent tool history */}
      <Show when={props.expanded && recentTools().length > 0}>
        <box flexDirection="column" marginTop={1} borderStyle="single" borderColor={theme.border} paddingTop={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.UNDERLINE}>
            Recent tools
          </text>
          <For each={recentTools()}>
            {(tool) => (
              <box flexDirection="row" gap={1}>
                <text fg={tool.status === "completed" ? theme.success : tool.status === "running" ? theme.warning : tool.status === "error" ? theme.error : theme.textMuted}>
                  {tool.status === "completed" ? "✓" : tool.status === "running" ? "●" : tool.status === "error" ? "✗" : "○"}
                </text>
                <text fg={theme.text}>{tool.name}</text>
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

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function ParallelStatus(props: { plan: Plan }) {
  const { theme } = useTheme()
  const dim = useTerminalDimensions()
  const sync = useSync()
  const [selected, setSelected] = createSignal(0)
  const [expanded, setExpanded] = createSignal<number | null>(null)
  const [elapsed, setElapsed] = createSignal(0)

  // Elapsed time timer
  const startTime = props.plan.time.approved ?? props.plan.time.created
  createEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Date.now() - startTime)
    }, 1000)
    return () => clearInterval(timer)
  })

  const running = () => props.plan.workers.filter((w) => w.status === "running").length
  const done = () => props.plan.workers.filter((w) => w.status === "done" || w.status === "merged").length
  const failed = () => props.plan.workers.filter((w) => w.status === "failed" || w.status === "conflict").length
  const total = () => props.plan.workers.length

  // Aggregate cost and tokens across all worker sessions
  const totals = createMemo(() => {
    let totalCost = 0
    let totalInput = 0
    let totalOutput = 0
    let totalTools = 0

    for (const worker of props.plan.workers) {
      if (!worker.sessionID) continue
      const msgs = sync.data.message[worker.sessionID] ?? []
      for (const msg of msgs) {
        if (msg.role !== "assistant") continue
        totalCost += msg.cost ?? 0
        totalInput += msg.tokens?.input ?? 0
        totalOutput += msg.tokens?.output ?? 0
        const parts = sync.data.part[msg.id] ?? []
        totalTools += parts.filter((p) => p.type === "tool").length
      }
    }

    return { cost: totalCost, input: totalInput, output: totalOutput, tools: totalTools }
  })

  const width = () => Math.min(100, dim().width - 2)

  // Responsive columns: expanded=1, wide=3, medium=2, narrow=1
  const columns = () => {
    if (expanded() !== null) return 1
    const w = width()
    if (w >= 100 && total() >= 3) return 3
    if (w >= 60 && total() >= 2) return 2
    return 1
  }

  // Split workers into rows
  const rows = createMemo(() => {
    const cols = columns()
    const workers = expanded() !== null
      ? [props.plan.workers[expanded()!]]
      : props.plan.workers
    const result: typeof workers[] = []
    for (let i = 0; i < workers.length; i += cols) {
      result.push(workers.slice(i, i + cols))
    }
    return result
  })

  useKeyboard((evt) => {
    if (evt.name === "up" || evt.sequence === "k") {
      evt.preventDefault()
      setSelected((s) => Math.max(0, s - 1))
    } else if (evt.name === "down" || evt.sequence === "j") {
      evt.preventDefault()
      setSelected((s) => Math.min(total() - 1, s + 1))
    } else if (evt.name === "return") {
      evt.preventDefault()
      setExpanded((e) => (e === selected() ? null : selected()))
    } else if (evt.name === "escape") {
      evt.preventDefault()
      if (expanded() !== null) {
        setExpanded(null)
      }
    }
  })

  return (
    <box flexDirection="column" width={width()} backgroundColor={theme.backgroundPanel} padding={1}>
      {/* Header */}
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

      {/* Progress bar */}
      <box marginBottom={1}>
        <text fg={theme.success}>{"█".repeat(Math.floor((done() / Math.max(total(), 1)) * 30))}</text>
        <text fg={theme.warning}>{"█".repeat(Math.floor((running() / Math.max(total(), 1)) * 30))}</text>
        <text fg={theme.textMuted}>{"░".repeat(Math.max(0, 30 - Math.floor(((done() + running()) / Math.max(total(), 1)) * 30)))}</text>
      </box>

      {/* Worker lanes */}
      <For each={rows()}>
        {(row) => (
          <box flexDirection="row" gap={1} marginBottom={1}>
            <For each={row}>
              {(worker) => {
                const index = () => props.plan.workers.indexOf(worker)
                const subtask = () => props.plan.subtasks.find((s) => s.id === worker.subtaskID)
                return (
                  <box flexGrow={1} flexBasis={0} onMouseUp={() => setExpanded((e) => (e === index() ? null : index()))}>
                    <WorkerLane
                      worker={worker}
                      subtask={subtask()}
                      selected={selected() === index()}
                      expanded={expanded() === index()}
                      planWorkerModel={props.plan.workerModel.modelID}
                    />
                  </box>
                )
              }}
            </For>
          </box>
        )}
      </For>

      {/* Totals */}
      <box marginTop={1} paddingTop={1} borderStyle="single" borderColor={theme.border} flexDirection="column" gap={0}>
        <box flexDirection="row" gap={2}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>Total:</text>
          <text fg={theme.accent}>{formatCost(totals().cost)}</text>
          <text fg={theme.textMuted}>
            {formatTokens(totals().input)} in / {formatTokens(totals().output)} out
          </text>
          <text fg={theme.textMuted}>{totals().tools} tool calls</text>
          <text fg={theme.textMuted}>{formatDuration(elapsed())}</text>
        </box>
        <box flexDirection="row" gap={2} marginTop={1}>
          <text fg={theme.textMuted}>
            arrows navigate | enter expand/collapse | esc back
          </text>
        </box>
      </box>
    </box>
  )
}
