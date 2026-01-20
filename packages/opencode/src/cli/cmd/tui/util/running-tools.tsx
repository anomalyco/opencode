import { createMemo, type Accessor } from "solid-js"
import type { Part, ToolPart } from "@opencode-ai/sdk/v2"
import { formatDuration } from "../../../../util/format"
import { useTheme } from "../context/theme"
import { extractToolCommand, RUNNING_THRESHOLD_MS, type RunningItem } from "./running-utils"

type ToolsData = {
  message: Record<string, { id: string }[]>
  part: Record<string, Part[]>
}

export function createRunningTools(
  sessionID: Accessor<string>,
  data: ToolsData,
  tick: Accessor<number>,
): Accessor<RunningItem[]> {
  const messages = createMemo(() => data.message[sessionID()] ?? [])

  return createMemo(() => {
    const now = tick()
    const tools: { id: string; tool: string; input: Record<string, unknown>; startTime: number }[] = []

    for (const message of messages()) {
      const parts = data.part[message.id] ?? []
      for (const part of parts) {
        if (part.type === "tool") {
          const toolPart = part as ToolPart
          if (toolPart.state.status === "running") {
            const startTime = toolPart.state.time.start
            if (now - startTime >= RUNNING_THRESHOLD_MS) {
              tools.push({
                id: toolPart.id,
                tool: toolPart.tool,
                input: toolPart.state.input,
                startTime,
              })
            }
          }
        }
      }
    }

    // Sort and number agents
    const sorted = tools.sort((a, b) => a.startTime - b.startTime)
    let agentIndex = 0
    return sorted.map((tool) => {
      let label: string
      if (tool.tool === "task") {
        agentIndex++
        const desc = (tool.input.description as string) || "..."
        label = `agent${agentIndex}: ${desc}`
      } else {
        label = extractToolCommand(tool.tool, tool.input)
      }
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
