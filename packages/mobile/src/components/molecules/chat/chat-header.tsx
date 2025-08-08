import { memo, useState, useEffect, useRef, useCallback } from "react"
import { Box, Text, Button, Icon } from "@/components/ui/primitives"
import BlurView from "@/components/ui/primitives/blur-view"
import { Feather } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import { calculateSessionContext, formatSessionContext } from "@/utils/calculate-session-context"
import { useSSEService } from "@/services/sse-service"
import { useRemoteMessagesQuery } from "@/services/api/remote/messages"
import { useChatService } from "@/services/chat-service"
import { useLocalSessionQuery } from "@/services/api/local/sessions"
import { useSessionManager } from "@/services/session-manager"
import { useCurrentAgentQuery } from "@/services/api/local/user-settings"
import type { SSEEvent } from "@/types/opencode-types"

interface ChatHeaderProps {
  sessionId: string
}

export const ChatHeader = memo(({ sessionId }: ChatHeaderProps) => {
  const router = useRouter()
  const [sessionInfoText, setSessionInfoText] = useState("AI Development Assistant")
  const sseService = useSSEService()
  const chatService = useChatService()
  const updateTimeoutRef = useRef<number | null>(null)
  const [hasSyncedMessages, setHasSyncedMessages] = useState(false)

  // Get session data and services
  const { data: session } = useLocalSessionQuery(sessionId)
  const { data: currentAgent } = useCurrentAgentQuery()
  const sessionManager = useSessionManager()

  // Fetch remote messages to trigger sync
  const { data: remoteMessages } = useRemoteMessagesQuery(sessionId)

  const handleBackPress = () => {
    router.back()
  }

  // Handle new session
  const handleNewSession = useCallback(async () => {
    try {
      await sessionManager.navigateToNewSession()
    } catch (error) {}
  }, [sessionManager])

  // Update session context
  const updateSessionInfo = async () => {
    if (!sessionId) {
      setSessionInfoText("AI Development Assistant")
      return
    }

    try {
      const context = await calculateSessionContext(sessionId)
      const formatted = formatSessionContext(context, false)
      setSessionInfoText(formatted)
    } catch (error) {
      console.error("Failed to calculate session context:", error)
      setSessionInfoText("AI Development Assistant")
    }
  }

  // Sync remote messages when they're available (only if not already synced)
  useEffect(() => {
    if (!sessionId || !remoteMessages || hasSyncedMessages) return

    if (remoteMessages.length > 0) {
      // Small delay to let the message list component handle sync first
      const syncTimeout = setTimeout(() => {
        chatService
          .syncRemoteMessages(sessionId, remoteMessages)
          .then(() => {
            setHasSyncedMessages(true)
            // Update session info after sync
            setTimeout(updateSessionInfo, 300)
          })
          .catch((error) => {
            console.error("Failed to sync messages in header:", error)
            // Even if sync fails, mark as attempted to avoid retries
            setHasSyncedMessages(true)
          })
      }, 100)

      return () => clearTimeout(syncTimeout)
    }
  }, [sessionId, remoteMessages, hasSyncedMessages, chatService])

  // Calculate session context (matching TUI logic)
  useEffect(() => {
    updateSessionInfo()
  }, [sessionId, session?.messageCount])

  // Reset sync state when session changes
  useEffect(() => {
    setHasSyncedMessages(false)
  }, [sessionId])

  // Listen for streaming updates to refresh usage in real-time
  useEffect(() => {
    if (!sessionId) return

    const handleSSEEvent = (event: SSEEvent) => {
      switch (event.type) {
        case "message.updated":
        case "message.part.updated":
          // Throttle updates during streaming to avoid too many recalculations
          if (updateTimeoutRef.current) {
            clearTimeout(updateTimeoutRef.current)
          }
          updateTimeoutRef.current = window.setTimeout(() => {
            updateSessionInfo()
          }, 1000) // Update every second during streaming
          break
        case "session.idle":
          // Immediate update when streaming completes
          if (updateTimeoutRef.current) {
            clearTimeout(updateTimeoutRef.current)
          }
          updateSessionInfo()
          break
      }
    }

    const unsubscribe = sseService.subscribeToSession(sessionId, handleSSEEvent)

    return () => {
      unsubscribe()
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
      }
    }
  }, [sessionId, sseService])

  return (
    <BlurView
      intensity={80}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
      }}
    >
      <Box
        direction="row"
        alignItems="center"
        p="md"
        safeAreaTop
        mode={currentAgent === "plan" ? "secondary" : undefined}
        style={{
          borderBottomWidth: 1,
          borderBottomColor: "rgba(0,0,0,0.1)",
        }}
      >
        <Button variant="ghost" onPress={handleBackPress} style={{ paddingHorizontal: 8 }}>
          <Icon icon={Feather} name="chevron-left" size={24} color="muted" />
        </Button>
        <Box
          background="lightest"
          rounded="full"
          style={{
            width: 36,
            height: 36,
            alignItems: "center",
            justifyContent: "center",
            marginRight: 12,
          }}
        >
          <Icon icon={Feather} name="cpu" size={18} color="brand" />
        </Box>
        <Box style={{ flex: 1 }}>
          <Text size="lg" weight="semibold" numberOfLines={1}>
            {session?.title || "OpenCode Assistant"}
          </Text>
          <Text size="xs" mode="subtle">
            {sessionInfoText}
          </Text>
        </Box>
        <Button
          mode="brand"
          size="auto"
          rounded="full"
          onPress={handleNewSession}
          style={{ padding: 8, marginLeft: 8 }}
        >
          <Button.Icon>
            {({ color, size }) => <Icon icon={Feather} name="plus" size={size} color={color} />}
          </Button.Icon>
        </Button>
      </Box>
    </BlurView>
  )
})

ChatHeader.displayName = "ChatHeader"
