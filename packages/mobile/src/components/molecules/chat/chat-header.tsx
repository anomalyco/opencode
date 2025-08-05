import { memo, useState, useEffect, useRef } from "react"
import { Box, Text, Button, Icon } from "@/components/ui/primitives"
import BlurView from "@/components/ui/primitives/blur-view"
import { Feather } from "@expo/vector-icons"
import { useRouter } from "expo-router"
import { calculateSessionContext, formatSessionContext } from "@/utils/calculate-session-context"
import { useSSEService } from "@/services/sse-service"
import { useRemoteMessagesQuery } from "@/services/api/remote/messages"
import { useChatService } from "@/services/chat-service"
import type { Session } from "@/db/types"
import type { SSEEvent } from "@/types/opencode-types"

interface ChatHeaderProps {
  sessionTitle?: string
  session?: Session | null
  onNewSessionPress?: () => void
  currentMode?: string
}

export const ChatHeader = memo(({ sessionTitle, session, onNewSessionPress, currentMode }: ChatHeaderProps) => {
  const router = useRouter()
  const [sessionInfoText, setSessionInfoText] = useState("AI Development Assistant")
  const sseService = useSSEService()
  const chatService = useChatService()
  const updateTimeoutRef = useRef<number | null>(null)
  const [hasSyncedMessages, setHasSyncedMessages] = useState(false)

  // Fetch remote messages to trigger sync
  const { data: remoteMessages } = useRemoteMessagesQuery(session?.id || "")

  const handleBackPress = () => {
    router.back()
  }

  // Update session context
  const updateSessionInfo = async () => {
    if (!session?.id) {
      setSessionInfoText("AI Development Assistant")
      return
    }

    try {
      const context = await calculateSessionContext(session.id)
      const formatted = formatSessionContext(context, false)
      setSessionInfoText(formatted)
    } catch (error) {
      console.error("Failed to calculate session context:", error)
      setSessionInfoText("AI Development Assistant")
    }
  }

  // Sync remote messages when they're available (only if not already synced)
  useEffect(() => {
    if (!session?.id || !remoteMessages || hasSyncedMessages) return

    if (remoteMessages.length > 0) {
      // Small delay to let the message list component handle sync first
      const syncTimeout = setTimeout(() => {
        chatService
          .syncRemoteMessages(session.id, remoteMessages)
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
  }, [session?.id, remoteMessages, hasSyncedMessages, chatService])

  // Calculate session context (matching TUI logic)
  useEffect(() => {
    updateSessionInfo()
  }, [session?.id, session?.messageCount])

  // Reset sync state when session changes
  useEffect(() => {
    setHasSyncedMessages(false)
  }, [session?.id])

  // Listen for streaming updates to refresh usage in real-time
  useEffect(() => {
    if (!session?.id) return

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

    const unsubscribe = sseService.subscribeToSession(session.id, handleSSEEvent)

    return () => {
      unsubscribe()
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current)
      }
    }
  }, [session?.id, sseService])

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
        mode={currentMode === "plan" ? "secondary" : undefined}
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
            {sessionTitle || "OpenCode Assistant"}
          </Text>
          <Text size="xs" mode="subtle">
            {sessionInfoText}
          </Text>
        </Box>
        {onNewSessionPress && (
          <Button
            mode="brand"
            size="auto"
            rounded="full"
            onPress={onNewSessionPress}
            style={{ padding: 8, marginLeft: 8 }}
          >
            <Button.Icon>
              {({ color, size }) => <Icon icon={Feather} name="plus" size={size} color={color} />}
            </Button.Icon>
          </Button>
        )}
      </Box>
    </BlurView>
  )
})

ChatHeader.displayName = "ChatHeader"
