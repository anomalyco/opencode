import React from "react"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { ThemedMarked } from "@/components/ui/primitives/marked"
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

// Tool status indicator component
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
      <Text size="sm" mode="subtle" weight="medium">
        {getStatusText()}
      </Text>
    </Box>
  )
}

// File content renderer with syntax highlighting
interface FileContentRendererProps {
  filename: string
  content: string
  truncateLines?: number
}

export const FileContentRenderer: React.FC<FileContentRendererProps> = ({ filename, content, truncateLines }) => {
  const getFileExtension = (path: string): string => {
    const ext = path.split(".").pop()
    return ext ? ext.toLowerCase() : ""
  }

  const processContent = (content: string): string => {
    let lines = content.split("\n")

    // Truncate if specified
    if (truncateLines && lines.length > truncateLines) {
      lines = lines.slice(0, truncateLines)
      lines.push("...")
    }

    // Clean up whitespace and tabs
    lines = lines.map((line) => line.trimEnd().replace(/\t/g, "  "))

    return lines.join("\n")
  }

  const processedContent = processContent(content)
  const extension = getFileExtension(filename)
  const markdownContent = `\`\`\`${extension}\n${processedContent}\n\`\`\``

  return (
    <Box background="lighter" rounded="lg" p="sm" gap="xs" mode="primary">
      <Box direction="row" alignItems="center" gap="xs" pb="xs">
        <Icon icon={Feather} name="file-text" size={14} color="accent" />
        <Text size="sm" weight="medium" style={{ flex: 1 }} numberOfLines={1} ellipsizeMode="head">
          {filename}
        </Text>
      </Box>
      <ThemedMarked value={markdownContent} />
    </Box>
  )
}

// Bash command/output renderer
interface BashRendererProps {
  command: string
  stdout?: string
  stderr?: string
}

export const BashRenderer: React.FC<BashRendererProps> = ({ command, stdout, stderr }) => {
  const output = [stdout, stderr].filter(Boolean).join("\n")
  const markdownContent = `\`\`\`console\n$ ${command}\n${output}\n\`\`\``

  return (
    <Box background="darker" rounded="lg" p="sm" gap="xs" mode="secondary">
      <Box direction="row" alignItems="center" gap="xs" pb="xs">
        <Icon icon={Feather} name="terminal" size={14} color="success" />
        <Text size="sm" weight="medium" mode="subtle">
          Command
        </Text>
      </Box>
      <ThemedMarked value={markdownContent} />
    </Box>
  )
}

// Todo list renderer
interface TodoItem {
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority?: "high" | "medium" | "low"
}

interface TodoListRendererProps {
  todos: TodoItem[]
}

export const TodoListRenderer: React.FC<TodoListRendererProps> = ({ todos }) => {
  const getCheckboxIcon = (status: string) => {
    switch (status) {
      case "completed":
        return "check-square"
      case "in_progress":
        return "square"
      case "cancelled":
        return "x-square"
      default:
        return "square"
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "success"
      case "in_progress":
        return "accent"
      case "cancelled":
        return "muted"
      default:
        return "muted"
    }
  }

  return (
    <Box background="lightest" rounded="lg" p="sm" gap="xs" mode="warning">
      <Box direction="row" alignItems="center" gap="xs" pb="xs">
        <Icon icon={Feather} name="list" size={14} color="warning" />
        <Text size="sm" weight="medium">
          Plan
        </Text>
      </Box>
      <Box gap="xs">
        {todos.map((todo, index) => (
          <Box key={index} direction="row" alignItems="flex-start" gap="xs">
            <Icon
              icon={Feather}
              name={getCheckboxIcon(todo.status) as any}
              size={16}
              color={getStatusColor(todo.status) as any}
              style={{ marginTop: 2 }}
            />
            <Text
              size="sm"
              style={{
                flex: 1,
                textDecorationLine: todo.status === "cancelled" ? "line-through" : "none",
                opacity: todo.status === "cancelled" ? 0.6 : 1,
                fontWeight: todo.status === "in_progress" ? "600" : "normal",
              }}
            >
              {todo.content}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// Diff renderer (simplified version)
interface DiffRendererProps {
  filename: string
  diff: string
}

export const DiffRenderer: React.FC<DiffRendererProps> = ({ filename, diff }) => {
  return (
    <Box background="light" rounded="lg" p="sm" gap="xs" mode="success">
      <Box direction="row" alignItems="center" gap="xs" pb="xs">
        <Icon icon={Feather} name="edit-3" size={14} color="success" />
        <Text size="sm" weight="medium" style={{ flex: 1 }} numberOfLines={1} ellipsizeMode="head">
          Edit {filename}
        </Text>
      </Box>
      <ThemedMarked value={`\`\`\`diff\n${diff}\n\`\`\``} />
    </Box>
  )
}

// Web fetch content renderer
interface WebFetchRendererProps {
  url: string
  content: string
  format: "text" | "markdown" | "html"
}

export const WebFetchRenderer: React.FC<WebFetchRendererProps> = ({ url, content, format }) => {
  const truncatedContent = content.length > 1000 ? content.slice(0, 1000) + "..." : content

  return (
    <Box background="dim" rounded="lg" p="sm" gap="xs" mode="secondary">
      <Box direction="row" alignItems="center" gap="xs" pb="xs">
        <Icon icon={Feather} name="globe" size={14} color="brand" />
        <Text size="sm" weight="medium" style={{ flex: 1 }} numberOfLines={1} ellipsizeMode="middle">
          {url}
        </Text>
      </Box>
      {format === "markdown" || format === "html" ? (
        <ThemedMarked value={truncatedContent} />
      ) : (
        <Text size="sm" mode="subtle">
          {truncatedContent}
        </Text>
      )}
    </Box>
  )
}
