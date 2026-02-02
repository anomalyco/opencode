/** @jsxImportSource react */
import { Static, Box, Text } from "ink"
import type { Message } from "../state/types"
import { theme } from "../theme"

interface MessageListProps {
  messages: Message[]
}

export const MessageList = ({ messages }: MessageListProps) => (
  <Static items={messages}>
    {(message) => (
      <Box key={message.id} flexDirection="column" marginBottom={1}>
        <Text color={message.role === "user" ? theme.colors.primary : theme.colors.success}>
          {message.role === "user" ? "you" : "assistant"}
        </Text>
        {message.parts.map((part, i) => (
          <Text key={i}>{part.content}</Text>
        ))}
      </Box>
    )}
  </Static>
)
