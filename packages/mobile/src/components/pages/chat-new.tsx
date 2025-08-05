/**
 * Simplified Chat Page - Refactored Implementation
 * Uses sibling components to reduce re-renders
 */

import { useState, useRef, useEffect, useCallback } from "react"
import { Platform, KeyboardAvoidingView, Keyboard } from "react-native"
import { Box } from "@/components/ui/primitives"
import { ChatHeader, MessageInput } from "@/components/molecules/chat"
import { StreamingMessageList, type StreamingMessageListRef } from "@/components/molecules/chat/streaming-message-list"
import { useSessionManager } from "@/services/session-manager"
import { useSimpleChatState } from "@/hooks/use-simple-chat-state"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/services/api/keys"
// Mode switching functionality removed - will be re-implemented later
import { useSonner } from "@/hooks/use-sonner"

interface ChatPageProps {
  sessionId: string
}

export const ChatPage = ({ sessionId }: ChatPageProps) => {
  // UI-only state
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const messageListRef = useRef<StreamingMessageListRef>(null)

  // Session manager
  const sessionManager = useSessionManager()
  const queryClient = useQueryClient()

  const sonner = useSonner()

  // Simplified chat state - no streaming state here
  const { session, sendMessage, refreshMessages } = useSimpleChatState(sessionId)

  // Refresh session data when sessionId changes
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.local.sessions.detail(sessionId) })
  }, [sessionId, queryClient])

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
      sonner.success("Messages refreshed")
    } catch (err) {
      sonner.error("Failed to refresh")
    } finally {
      setRefreshing(false)
    }
  }, [refreshMessages, sonner])

  // Handle send message
  const handleSendMessage = useCallback(
    async (content: string) => {
      try {
        await sendMessage(content)
        setTimeout(() => messageListRef.current?.scrollToBottom(), 100)
      } catch (err) {
        sonner.error("Failed to send message")
      }
    },
    [sendMessage, sonner],
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
        <ChatHeader sessionTitle={session?.title} session={session} onNewSessionPress={handleNewSession} />
        <MessageInput onSend={handleSendMessage} />
      </Box>
    </KeyboardAvoidingView>
  )
}
