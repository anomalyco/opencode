/** @jsxImportSource react */
import { Box, Text } from "ink"
import Spinner from "ink-spinner"
import type { Task, Tool } from "../state/types"
import { theme } from "../theme"

interface TaskDisplayProps {
  task: Task
  agent: string
  elapsed?: number
}

export const TaskDisplay = ({ task, agent, elapsed }: TaskDisplayProps) => {
  const colors = task.state === "completed" ? theme.task.completed : theme.task.running
  const tools = Array.from(task.childTools.values())
  const runningTools = tools.filter((t) => t.state === "running")

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={colors.icon} bold>
          {task.state === "running" ? <Spinner type="dots" /> : "✓"}
        </Text>
        <Text dimColor> task </Text>
        <Text color={colors.text}>@{agent}:</Text>
        <Text> {task.description}</Text>
        {elapsed && elapsed > 0 && <Text dimColor> ({elapsed}s)</Text>}
      </Box>
      {runningTools.length > 0 && (
        <>
          {runningTools.map((tool, index) => (
            <Box key={tool.id} marginLeft={2}>
              <Text dimColor>→ </Text>
              <Text>{tool.name}: </Text>
              <Text dimColor>{getToolSummary(tool)}</Text>
            </Box>
          ))}
        </>
      )}
    </Box>
  )
}

const getToolSummary = (tool: Tool): string => {
  if (!tool?.input) return "starting"
  if (typeof tool.input !== "object" || tool.input === null) return "starting"
  const values = Object.values(tool.input)
  if (values.length === 0) return "starting"
  const firstValue = values[0]
  if (firstValue === undefined) return "starting"
  if (typeof firstValue === "string") {
    if (firstValue.length === 0) return "(empty)"
    return firstValue.slice(0, 40)
  }
  if (typeof firstValue === "number" || typeof firstValue === "boolean") return String(firstValue)
  if (firstValue === null) return "null"
  if (typeof firstValue === "object") {
    try {
      return JSON.stringify(firstValue).slice(0, 40)
    } catch {
      return "(complex)"
    }
  }
  return "running"
}
