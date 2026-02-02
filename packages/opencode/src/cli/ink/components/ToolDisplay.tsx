/** @jsxImportSource react */
import { Box, Text } from "ink"
import Spinner from "ink-spinner"
import type { Tool } from "../state/types"
import { theme } from "../theme"

interface ToolDisplayProps {
  tool: Tool
}

export const ToolDisplay = ({ tool }: ToolDisplayProps) => {
  const colors = tool.state === "pending" ? { icon: "gray", text: "gray" } : theme.tool[tool.state]

  const stateIcons: Record<Tool["state"], string | null> = {
    pending: "○",
    running: null,
    completed: "✓",
    error: "✗",
  }

  const icon = stateIcons[tool.state] ?? ""

  const getDisplayInput = () => {
    const inputValues = Object.values(tool.input ?? {})
    const inputValue = inputValues[0]
    if (inputValue === null || inputValue === undefined) return ""

    const value = String(inputValue)
    return value.slice(0, 50)
  }

  const displayInput = getDisplayInput()

  return (
    <Box aria-label={`Tool ${tool.name} in ${tool.state} state`}>
      {tool.state === "running" ? <Spinner type="dots" /> : <Text color={colors.icon}>{icon}</Text>}
      <Text color={colors.text}> {tool.name}</Text>
      {displayInput && <Text dimColor> {displayInput}</Text>}
    </Box>
  )
}
