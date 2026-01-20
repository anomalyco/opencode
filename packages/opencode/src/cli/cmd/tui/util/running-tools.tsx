import { createMemo, createEffect, type Accessor } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { Part, ToolPart, ToolStateRunning } from "@opencode-ai/sdk/v2"
import { formatDuration } from "../../../../util/format"
import { useTheme } from "../context/theme"
import { extractToolCommand, RUNNING_THRESHOLD_MS, str, type RunningItem, type TaskMetadata } from "./running-utils"

type ToolsData = {
  message: Record<string, { id: string }[]>
  part: Record<string, Part[]>
}

type RunningToolPart = ToolPart & { state: ToolStateRunning }

function hasRunningSubtasks(part: RunningToolPart): boolean {
  if (part.tool !== "task") return true
  const metadata = part.state.metadata as TaskMetadata | undefined
  return metadata?.summary?.some((t) => t.state?.status === "running") ?? false
}

function isRunningTool(part: Part, now: number): part is RunningToolPart {
  if (part.type !== "tool" || part.state.status !== "running") return false
  const running = part as RunningToolPart
  if (!hasRunningSubtasks(running)) return false
  return now - running.state.time.start >= RUNNING_THRESHOLD_MS
}

function getLabel(part: RunningToolPart, agentIndex: number): string {
  return part.tool === "task"
    ? `agent${agentIndex}: ${str(part.state.input.description) || "..."}`
    : extractToolCommand(part.tool, part.state.input)
}

export function createRunningTools(
  sessionID: Accessor<string>,
  data: ToolsData,
  tick: Accessor<number>,
): Accessor<RunningItem[]> {
  const [items, setItems] = createStore<RunningItem[]>([])
  const messages = createMemo(() => data.message[sessionID()] ?? [])

  createEffect(() => {
    const now = tick()

    const running = messages()
      .flatMap((msg) => data.part[msg.id] ?? [])
      .filter((part): part is RunningToolPart => isRunningTool(part, now))
      .sort((a, b) => a.state.time.start - b.state.time.start)

    const newItems = running.map((part, i) => ({
      id: part.id,
      label: getLabel(part, i + 1),
      startTime: part.state.time.start,
    }))

    setItems(reconcile(newItems, { key: "id" }))
  })

  return () => items
}

export function ToolItemView(props: { item: RunningItem; now: number }) {
  const { theme } = useTheme()
  const elapsed = () => formatDuration(Math.floor((props.now - props.item.startTime) / 1000))

  return (
    <box flexDirection="row" gap={1}>
      <text flexShrink={0} fg={theme.warning}>
        ●
      </text>
      <text fg={theme.text} wrapMode="none">
        {props.item.label}
        <span style={{ fg: theme.textMuted }}> {elapsed()}</span>
      </text>
    </box>
  )
}
