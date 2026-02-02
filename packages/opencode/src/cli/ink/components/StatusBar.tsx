/** @jsxImportSource react */
import { Box, Text } from "ink"
import { theme } from "../theme"

interface StatusBarProps {
  agent: string
  model?: string | null
  status?: "idle" | "busy" | "retry"
}

export const StatusBar = ({ agent, model, status = "idle" }: StatusBarProps) => {
  const statusColors = {
    idle: theme.colors.muted,
    busy: theme.colors.warning,
    retry: theme.colors.error,
  } as const

  return (
    <Box justifyContent="space-between">
      <Box>
        <Text color={theme.colors.primary}>{agent}</Text>
        {model && (
          <>
            <Text dimColor> · </Text>
            <Text dimColor>{model}</Text>
          </>
        )}
      </Box>
      <Text color={statusColors[status]}>{status}</Text>
    </Box>
  )
}
