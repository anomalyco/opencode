import { memo } from "react"
import { Box } from "@/components/ui/primitives"
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
  remoteMessages?: any[]
  localContent?: string
}

export const EnhancedMessageItem = memo(({ message, remoteMessages, localContent }: EnhancedMessageItemProps) => {
  const isUser = message.role === "user"

  // Get message parts from local SQLite for real-time updates
  const { data: localMessageParts } = useLocalMessagePartsQuery(message.id)

  // Fallback to remote message if no local content
  const remoteMessage = remoteMessages?.find((rm) => rm.info.id === message.id)

  // Combine local and remote parts
  const allParts = [...(localMessageParts || []), ...(remoteMessage?.parts || [])]

  // Remove duplicates based on part ID
  const uniqueParts = allParts.reduce((acc: any[], part: any) => {
    const existingIndex = acc.findIndex((p: any) => p.id === part.id)
    if (existingIndex >= 0) {
      // Keep the local version if it exists
      if (part.isSynced !== undefined) {
        acc[existingIndex] = part
      }
    } else {
      acc.push(part)
    }
    return acc
  }, [])

  // Sort parts by creation time for chronological rendering
  uniqueParts.sort((a, b) => {
    const aTime = a.timeStart || a.createdAt || 0
    const bTime = b.timeStart || b.createdAt || 0
    return new Date(aTime).getTime() - new Date(bTime).getTime()
  })

  // Don't render if no content
  if (uniqueParts.length === 0 && !localContent) {
    return null
  }

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
          <ToolStatusIndicator status={toolStatus} toolName={toolName} />
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
              <ThemedMarked value={`**${toolName}:**\n\`\`\`\n${toolOutput}\n\`\`\``} />
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

  // Handle local content for user messages
  const hasLocalContent = localContent && localContent.trim().length > 0

  // Calculate if this is a short message (text only, 1-2 lines)
  const allTextContent =
    uniqueParts
      .filter((part) => part.type === "text" && !part.isSynthetic)
      .map((part) => part.textContent || part.text)
      .join("\n") ||
    localContent ||
    ""

  const hasOnlyText = uniqueParts.every((part) => part.type === "text" || part.textContent) && !hasLocalContent
  const isShortMessage = hasOnlyText && allTextContent.length < 100 && allTextContent.split("\n").length <= 2

  return (
    <Box p={isShortMessage ? "sm" : "md"}>
      <Box direction="row" justifyContent={isUser ? "flex-end" : "flex-start"}>
        <Box
          background={isUser ? "emphasis" : "lightest"}
          rounded="xl"
          p={isShortMessage ? "sm" : "md"}
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
          {/* Render local content first for user messages */}
          {hasLocalContent && (
            <Box mb="sm">
              <ThemedMarked value={localContent} />
            </Box>
          )}

          {/* Render all parts in chronological order */}
          {uniqueParts.map((part, index) => renderPart(part, index))}
        </Box>
      </Box>
    </Box>
  )
})

EnhancedMessageItem.displayName = "EnhancedMessageItem"
