import React from "react"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { Feather } from "@expo/vector-icons"

// Tool action status messages (when tools are pending)
export const renderToolAction = (toolName: string): string => {
  switch (toolName) {
    case "task":
      return "Delegating..."
    case "bash":
      return "Writing command..."
    case "edit":
      return "Preparing edit..."
    case "webfetch":
      return "Fetching from the web..."
    case "glob":
      return "Finding files..."
    case "grep":
      return "Searching content..."
    case "list":
      return "Listing directory..."
    case "read":
      return "Reading file..."
    case "write":
      return "Preparing write..."
    case "todowrite":
    case "todoread":
      return "Planning..."
    case "patch":
      return "Preparing patch..."
    default:
      return "Working..."
  }
}

// Tool name formatting
export const renderToolName = (name: string): string => {
  switch (name) {
    case "webfetch":
      return "Fetch"
    default:
      const normalizedName = name.startsWith("opencode_") ? name.slice(9) : name
      return normalizedName.charAt(0).toUpperCase() + normalizedName.slice(1)
  }
}

interface ToolStatusIndicatorProps {
  status: "pending" | "running" | "completed" | "error"
  toolName: string
}

export const ToolStatusIndicator: React.FC<ToolStatusIndicatorProps> = ({ status, toolName }) => {
  const getStatusIcon = () => {
    switch (status) {
      case "pending":
        return "clock"
      case "running":
        return "loader"
      case "completed":
        return "check-circle"
      case "error":
        return "x-circle"
      default:
        return "help-circle"
    }
  }

  const getStatusColor = () => {
    switch (status) {
      case "pending":
        return "muted"
      case "running":
        return "accent"
      case "completed":
        return "success"
      case "error":
        return "error"
      default:
        return "muted"
    }
  }

  const getStatusText = () => {
    if (status === "pending" || status === "running") {
      return renderToolAction(toolName)
    }
    return renderToolName(toolName)
  }

  const getBackgroundMode = () => {
    switch (status) {
      case "pending":
        return "dim"
      case "running":
        return "lighter"
      case "completed":
        return "subtle"
      case "error":
        return "darker"
      default:
        return "subtle"
    }
  }

  const getMode = () => {
    switch (status) {
      case "pending":
        return "disabled"
      case "running":
        return "primary"
      case "completed":
        return "success"
      case "error":
        return "error"
      default:
        return undefined
    }
  }

  return (
    <Box
      direction="row"
      alignItems="center"
      gap="xs"
      p="sm"
      background={getBackgroundMode()}
      rounded="md"
      mode={getMode()}
    >
      <Icon
        icon={Feather}
        name={getStatusIcon() as any}
        size={14}
        color={getStatusColor() as any}
        style={status === "running" ? { opacity: 0.7 } : undefined}
      />
      <Text size="xs" mode="subtle" weight="medium">
        {getStatusText()}
      </Text>
    </Box>
  )
}
