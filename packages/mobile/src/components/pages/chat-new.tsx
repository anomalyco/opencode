/**
 * Simplified Chat Page - Pure Layout Container
 * All state management moved to child components to reduce re-renders
 */

import { Platform, KeyboardAvoidingView } from "react-native"
import { Box, type BottomSheetRef } from "@/components/ui/primitives"
import { ChatHeader, MessageInput } from "@/components/molecules/chat"
import { StreamingMessageList } from "@/components/molecules/chat/streaming-message-list"
import { CommandsSheet } from "../molecules/chat/commands-sheet"
import { ModelsSheet } from "../molecules/chat/models-sheet"
import { useRef } from "react"

interface ChatPageProps {
  sessionId: string
}

export const ChatPage = ({ sessionId }: ChatPageProps) => {
  const commandsSheetRef = useRef<BottomSheetRef>(null)
  const modelsSheetRef = useRef<BottomSheetRef>(null)

  const handleShowModels = () => {
    modelsSheetRef.current?.present()
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <Box flex background="base">
        <StreamingMessageList sessionId={sessionId} />
        <ChatHeader sessionId={sessionId} />
        <MessageInput sessionId={sessionId} commandsSheetRef={commandsSheetRef} modelsSheetRef={modelsSheetRef} />
        <CommandsSheet ref={commandsSheetRef} sessionId={sessionId} onShowModels={handleShowModels} />
        <ModelsSheet ref={modelsSheetRef} sessionId={sessionId} />
      </Box>
    </KeyboardAvoidingView>
  )
}
