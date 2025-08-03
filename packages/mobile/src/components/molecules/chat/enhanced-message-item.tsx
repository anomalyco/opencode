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

  // Sort parts by creation time or order
  uniqueParts.sort((a, b) => {
    const aTime = a.timeStart || a.createdAt || 0
    const bTime = b.timeStart || b.createdAt || 0
    return new Date(aTime).getTime() - new Date(bTime).getTime()
  })

  // Group parts by type for rendering
  const textParts = uniqueParts.filter(
    (part) => (part.type === "text" && !part.isSynthetic) || (part.textContent && !part.isSynthetic),
  )
  const toolParts = uniqueParts.filter((part) => part.type === "tool" || part.toolName)
  const fileParts = uniqueParts.filter((part) => part.type === "file" || part.fileFilename)

  // Don't render if no content
  if (textParts.length === 0 && toolParts.length === 0 && fileParts.length === 0 && !localContent) {
    return null
  }

  const renderTextContent = () => {
    const textContent = textParts.map((part) => part.textContent || part.text).join("\n") || localContent
    if (!textContent) return null

    return (
      <Box mb="sm">
        <ThemedMarked value={textContent} />
      </Box>
    )
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
        <Box key={part.id} mb="sm" background="darker" rounded="md" p="sm">
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

  return (
    <Box p="md">
      <Box direction="row" justifyContent={isUser ? "flex-end" : "flex-start"}>
        <Box
          background={isUser ? "emphasis" : "lightest"}
          rounded="xl"
          p="md"
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
          {/* Render text content */}
          {renderTextContent()}

          {/* Render tool parts */}
          {toolParts.map(renderToolPart)}

          {/* Render file parts */}
          {fileParts.map(renderFilePart)}
        </Box>
      </Box>
    </Box>
  )
})

EnhancedMessageItem.displayName = "EnhancedMessageItem"
