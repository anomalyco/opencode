/**
 * Simplified Chat Page - Refactored Implementation
 * Uses sibling components to reduce re-renders
 */

import { useState, useRef, useEffect, useCallback } from "react"
import { Platform, KeyboardAvoidingView, Keyboard } from "react-native"
import { Box } from "@/components/ui/primitives"
import { ChatHeader, MessageInput, type MessageListRef } from "@/components/molecules/chat"
import { StreamingMessageList } from "@/components/molecules/chat/streaming-message-list"
import { useSessionManager } from "@/services/session-manager"
import { useSimpleChatState } from "@/hooks/use-simple-chat-state"

interface ChatPageProps {
  sessionId: string
}

export const ChatPage = ({ sessionId }: ChatPageProps) => {
  // UI-only state
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const messageListRef = useRef<MessageListRef>(null)

  // Session manager
  const sessionManager = useSessionManager()

  // Simplified chat state - no streaming state here
  const { session, sendMessage, refreshMessages } = useSimpleChatState(sessionId)

  // Keyboard handling
  useEffect(() => {
    const keyboardWillShow = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (event) => {
        setKeyboardHeight(event.endCoordinates.height)
        setTimeout(() => messageListRef.current?.scrollToBottom(), 100)
      },
    )

    const keyboardWillHide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => {
        setKeyboardHeight(0)
      },
    )

    return () => {
      keyboardWillShow.remove()
      keyboardWillHide.remove()
    }
  }, [])

  // Auto-scroll is now handled by StreamingMessageList

  // Handle pull-to-refresh
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refreshMessages()
    } catch (err) {
    } finally {
      setRefreshing(false)
    }
  }, [refreshMessages])

  // Handle send message
  const handleSendMessage = useCallback(
    async (content: string) => {
      try {
        await sendMessage(content)
        setTimeout(() => messageListRef.current?.scrollToBottom(), 100)
      } catch (err) {}
    },
    [sendMessage],
  )

  // Handle new session
  const handleNewSession = useCallback(async () => {
    try {
      await sessionManager.navigateToNewSession()
    } catch (error) {}
  }, [sessionManager])

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <Box flex background="base">
        <StreamingMessageList
          ref={messageListRef}
          sessionId={sessionId}
          keyboardHeight={keyboardHeight}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
        <ChatHeader sessionTitle={session?.title} onNewSessionPress={handleNewSession} />
        <MessageInput onSend={handleSendMessage} />
      </Box>
    </KeyboardAvoidingView>
  )
}
