import { createMemo, type Accessor } from "solid-js"
import type { Part, ToolPart, ToolStateRunning } from "@opencode-ai/sdk/v2"
import { formatDuration } from "../../../../util/format"
import { useTheme } from "../context/theme"
import { extractToolCommand, RUNNING_THRESHOLD_MS, type RunningItem } from "./running-utils"

type ToolsData = {
  message: Record<string, { id: string }[]>
  part: Record<string, Part[]>
}

type RunningToolPart = ToolPart & { state: ToolStateRunning }

function isRunningTool(part: Part, now: number): part is RunningToolPart {
  return part.type === "tool" && part.state.status === "running" && now - part.state.time.start >= RUNNING_THRESHOLD_MS
}

export function createRunningTools(
  sessionID: Accessor<string>,
  data: ToolsData,
  tick: Accessor<number>,
): Accessor<RunningItem[]> {
  const messages = createMemo(() => data.message[sessionID()] ?? [])

  return createMemo(() => {
    const now = tick()

    const tools = messages()
      .flatMap((msg) => data.part[msg.id] ?? [])
      .filter((part): part is RunningToolPart => isRunningTool(part, now))
      .map((part) => ({
        id: part.id,
        tool: part.tool,
        input: part.state.input,
        startTime: part.state.time.start,
      }))
      .sort((a, b) => a.startTime - b.startTime)

    let agentIndex = 0
    return tools.map((tool) => {
      const label =
        tool.tool === "task"
          ? `agent${++agentIndex}: ${(tool.input.description as string) || "..."}`
          : extractToolCommand(tool.tool, tool.input)
      return { id: tool.id, label, startTime: tool.startTime }
    })
  })
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
