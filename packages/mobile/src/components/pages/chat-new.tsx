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
import { useCurrentModeQuery, useSwitchModeMutation } from "@/services/api/local/user-settings"
import { useSonner } from "@/hooks/use-sonner"
import { Ionicons } from "@expo/vector-icons"

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

  // Mode management
  const { data: currentMode } = useCurrentModeQuery()
  const switchModeMutation = useSwitchModeMutation()

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

  // Handle pull-to-refresh with mode toggle
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      // Toggle mode on refresh
      const newMode = await switchModeMutation.mutateAsync()
      await refreshMessages()

      // Show mode switch toast with appropriate color
      if (newMode === "build") {
        // Primary color for build mode with hammer icon
        sonner.info("Switched to build mode", {
          duration: 2000,
          icon: {
            component: Ionicons,
            name: "hammer",
            size: 20,
          },
        })
      } else {
        // Secondary color for plan mode with document icon
        sonner.secondary("Switched to plan mode", {
          duration: 2000,
          icon: {
            component: Ionicons,
            name: "document-text",
            size: 20,
          },
        })
      }
    } catch (err) {
      sonner.error("Failed to switch mode")
    } finally {
      setRefreshing(false)
    }
  }, [refreshMessages, switchModeMutation, sonner])

  // Handle send message
  const handleSendMessage = useCallback(
    async (content: string) => {
      try {
        await sendMessage(content, currentMode)
      } catch (err) {
        // Don't show error since messages are processed via SSE
        // Real errors will be shown through SSE events
        console.log("Message send HTTP error (message may still process via SSE):", err)
      }
    },
    [sendMessage, currentMode],
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
        <MessageInput onSend={handleSendMessage} currentMode={currentMode} />
      </Box>
    </KeyboardAvoidingView>
  )
}
