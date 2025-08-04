import { memo, useMemo } from "react"
import { Box, Text } from "@/components/ui/primitives"
import { ThemedMarked } from "@/components/ui/primitives/marked"
import { useLocalMessagePartsQuery } from "@/services/api/local/messages"
import {
  ToolStatusIndicator,
  FileContentRenderer,
  BashRenderer,
  TodoListRenderer,
  DiffRenderer,
  WebFetchRenderer,
} from "./message-renderers"

interface EnhancedMessageItemProps {
  message: {
    id: string
    role: "user" | "assistant"
    createdAt: Date
  }
  remoteMessages?: any[] // Deprecated - keeping for compatibility
  localContent?: string // Deprecated - keeping for compatibility
}

export const EnhancedMessageItem = memo(({ message }: EnhancedMessageItemProps) => {
  const isUser = message.role === "user"

  // Get message parts from local SQLite - with new architecture, everything is synced locally
  const { data: localMessageParts } = useLocalMessagePartsQuery(message.id)

  // Use only local parts since we sync everything through the chat service
  const uniqueParts = localMessageParts || []

  // Database returns parts ordered by createdAt (insertion order) - matches TUI behavior
  const sortedParts = useMemo(() => {
    // Use parts in insertion order (createdAt) to match TUI behavior
    // Text parts should appear first, followed by tool calls and other parts
    return [...uniqueParts]
  }, [uniqueParts])

  const renderPart = (part: any, index: number) => {
    const partType = part.type || (part.toolName ? "tool" : part.fileFilename ? "file" : "text")

    switch (partType) {
      case "text":
        if (part.isSynthetic || !part.textContent) return null
        return (
          <Box key={part.id || index} mb="sm">
            <ThemedMarked value={part.textContent} />
          </Box>
        )

      case "tool":
        return renderToolPart(part)

      case "file":
        return renderFilePart(part)

      case "step-start":
      case "step-finish":
        // These are internal workflow steps, don't render them
        return null

      default:
        return null
    }
  }

  const renderToolPart = (part: any) => {
    const toolName = part.toolName || part.tool
    const toolStatus = part.toolStatus || part.state?.status || "pending"
    const toolInput = part.toolInput ? JSON.parse(part.toolInput) : part.state?.input
    const toolOutput = part.toolOutput || part.state?.output
    const toolMetadata = part.toolMetadata ? JSON.parse(part.toolMetadata) : part.state?.metadata
    const toolError = part.toolError || part.state?.error

    // Show status indicator for pending/running tools
    if (toolStatus === "pending" || toolStatus === "running") {
      return (
        <Box key={part.id} mb="sm">
          <ToolStatusIndicator status={toolStatus} toolName={toolName || "Working..."} />
        </Box>
      )
    }

    // Show basic tool info even if incomplete
    if (!toolName && !toolOutput && !toolError) {
      return (
        <Box key={part.id} mb="sm" background="subtle" rounded="md" p="sm">
          <Text size="xs" weight="medium" mode="subtle">
            Tool call in progress...
          </Text>
        </Box>
      )
    }

    // Show error state
    if (toolStatus === "error" && toolError) {
      return (
        <Box key={part.id} mb="sm" background="lighter" rounded="md" p="sm" mode="error">
          <ThemedMarked value={`**Error in ${toolName}:** ${toolError}`} />
        </Box>
      )
    }

    // Render completed tools based on type
    switch (toolName) {
      case "read":
        if (toolMetadata?.preview && toolInput?.filePath) {
          return (
            <Box key={part.id} mb="sm">
              <FileContentRenderer filename={toolInput.filePath} content={toolMetadata.preview} truncateLines={6} />
            </Box>
          )
        }
        break

      case "edit":
        if (toolMetadata?.diff && toolInput?.filePath) {
          return (
            <Box key={part.id} mb="sm">
              <DiffRenderer filename={toolInput.filePath} diff={toolMetadata.diff} />
            </Box>
          )
        }
        break

      case "write":
        if (toolInput?.filePath && toolInput?.content) {
          return (
            <Box key={part.id} mb="sm">
              <FileContentRenderer filename={toolInput.filePath} content={toolInput.content} />
            </Box>
          )
        }
        break

      case "bash":
        if (toolInput?.command) {
          return (
            <Box key={part.id} mb="sm">
              <BashRenderer command={toolInput.command} stdout={toolMetadata?.stdout} stderr={toolMetadata?.stderr} />
            </Box>
          )
        }
        break

      case "todowrite":
        if (toolMetadata?.todos) {
          return (
            <Box key={part.id} mb="sm">
              <TodoListRenderer todos={toolMetadata.todos} />
            </Box>
          )
        }
        break

      case "webfetch":
        if (toolInput?.url && toolOutput) {
          return (
            <Box key={part.id} mb="sm">
              <WebFetchRenderer url={toolInput.url} content={toolOutput} format={toolInput.format || "text"} />
            </Box>
          )
        }
        break

      default:
        // Generic tool output
        if (toolOutput) {
          return (
            <Box key={part.id} mb="sm" background="subtle" rounded="md" p="sm">
              <Box mb="xs">
                <Text size="xs" weight="medium" mode="subtle">
                  {toolName || "Tool"}
                </Text>
              </Box>
              <Text size="xs" mode="subtle" style={{ fontFamily: "monospace", lineHeight: 16 }}>
                {toolOutput}
              </Text>
            </Box>
          )
        }

        // Show tool name even without output for completed tools
        if (toolName && toolStatus === "completed") {
          return (
            <Box key={part.id} mb="sm" background="subtle" rounded="md" p="sm">
              <Text size="xs" weight="medium" mode="subtle">
                ✓ {toolName}
              </Text>
            </Box>
          )
        }
    }

    return null
  }

  const renderFilePart = (part: any) => {
    if (part.fileFilename && part.fileUrl) {
      return (
        <Box key={part.id} mb="sm">
          <FileContentRenderer
            filename={part.fileFilename}
            content={part.fileUrl} // This might need to be fetched
          />
        </Box>
      )
    }
    return null
  }

  // Calculate if this is a short message (text only, 1-2 lines) - memoized for performance
  const messageMetrics = useMemo(() => {
    const allTextContent =
      sortedParts
        .filter((part) => part.type === "text" && !part.isSynthetic)
        .map((part) => part.textContent)
        .join("\n") || ""

    const hasOnlyText = sortedParts.every((part) => part.type === "text" || part.textContent)
    const isShortMessage = hasOnlyText && allTextContent.length < 100 && allTextContent.split("\n").length <= 2

    return { allTextContent, hasOnlyText, isShortMessage }
  }, [sortedParts])

  // Don't render if no content
  if (sortedParts.length === 0) {
    return null
  }

  return (
    <Box p={messageMetrics.isShortMessage ? "sm" : "md"}>
      <Box direction="row" justifyContent={isUser ? "flex-end" : "flex-start"}>
        <Box
          background={isUser ? "emphasis" : "lightest"}
          rounded="xl"
          p={messageMetrics.isShortMessage ? "sm" : "md"}
          style={{
            maxWidth: "85%",
            minWidth: "20%",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05,
            shadowRadius: 2,
            elevation: 1,
          }}
        >
          {/* All content is now in parts from local database */}

          {/* Render all parts in chronological order */}
          {sortedParts.map((part, index) => renderPart(part, index))}
        </Box>
      </Box>
    </Box>
  )
})

EnhancedMessageItem.displayName = "EnhancedMessageItem"
