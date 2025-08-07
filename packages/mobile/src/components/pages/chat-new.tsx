/**
 * Simplified Chat Page - Pure Layout Container
 * All state management moved to child components to reduce re-renders
 */

import { Platform, KeyboardAvoidingView } from "react-native"
import { Box } from "@/components/ui/primitives"
import { ChatHeader, MessageInput } from "@/components/molecules/chat"
import { StreamingMessageList } from "@/components/molecules/chat/streaming-message-list"

interface ChatPageProps {
  sessionId: string
}

export const ChatPage = ({ sessionId }: ChatPageProps) => {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <Box flex background="base">
        <StreamingMessageList sessionId={sessionId} />
        <ChatHeader sessionId={sessionId} />
        <MessageInput sessionId={sessionId} />
      </Box>
    </KeyboardAvoidingView>
  )
}
