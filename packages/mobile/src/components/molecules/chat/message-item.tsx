import { memo } from "react"
import { Box } from "@/components/ui/primitives"
import { ThemedMarked } from "@/components/ui/primitives/marked"
import { useLocalMessagePartsQuery } from "@/services/api/local/messages"

interface MessageItemProps {
  message: {
    id: string
    role: "user" | "assistant"
    createdAt: Date
  }
  remoteMessages?: any[]
  localContent?: string
}

export const MessageItem = memo(({ message, remoteMessages, localContent }: MessageItemProps) => {
  const isUser = message.role === "user"

  // Get message parts from local SQLite for real-time updates
  const { data: localMessageParts } = useLocalMessagePartsQuery(message.id)
  const localTextParts = localMessageParts?.filter((part) => part.type === "text" && !part.isSynthetic) || []
  const localTextContent = localTextParts.map((part) => part.textContent).join("\n")

  // Fallback to remote message if no local content
  const remoteMessage = remoteMessages?.find((rm) => rm.info.id === message.id)
  const remoteTextParts = remoteMessage?.parts?.filter((part: any) => part.type === "text" && !part.synthetic) || []
  const remoteTextContent = remoteTextParts.map((part: any) => part.text).join("\n")

  // Use local content first (for streaming), then provided localContent, then remote, then fallback
  const content = localTextContent || localContent || remoteTextContent

  // Don't render if no content
  if (!content) {
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
          <ThemedMarked value={content} />
        </Box>
      </Box>
    </Box>
  )
})

MessageItem.displayName = "MessageItem"
