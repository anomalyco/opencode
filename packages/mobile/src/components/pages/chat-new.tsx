/**
 * Simplified Chat Page - Refactored Implementation
 * Uses services and hooks instead of complex useEffects
 */

import { useState, useRef, useEffect, useCallback, memo } from "react"
import { FlatList, RefreshControl, Platform, KeyboardAvoidingView, Keyboard } from "react-native"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { ChatHeader, MessageInput, TypingIndicator, EnhancedMessageItem } from "@/components/molecules/chat"
import { useSessionManager } from "@/services/session-manager"
import { useChatState } from "@/hooks/use-chat-state"
import { Feather } from "@expo/vector-icons"

interface ChatPageProps {
  sessionId: string
}

// Memoized FlatList for performance
const MemoizedFlatList = memo(FlatList<any>)

export const ChatPage = ({ sessionId }: ChatPageProps) => {
  // UI-only state
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const flatListRef = useRef<FlatList>(null)

  // Session manager
  const sessionManager = useSessionManager()

  // Combined chat state from hook
  const { messages, session, isLoading, isStreaming, error, sendMessage, refreshMessages } = useChatState(sessionId)

  // Scroll to bottom helper
  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true })
  }, [])

  // Keyboard handling
  useEffect(() => {
    const keyboardWillShow = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (event) => {
        setKeyboardHeight(event.endCoordinates.height)
        setTimeout(scrollToBottom, 100)
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
  }, [scrollToBottom])

  // Auto-scroll when streaming completes
  useEffect(() => {
    if (!isStreaming && messages.length > 0) {
      setTimeout(scrollToBottom, 200)
    }
  }, [isStreaming, messages.length, scrollToBottom])

  // Handle pull-to-refresh
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refreshMessages()
    } catch (err) {
      console.error("Refresh failed:", err)
    } finally {
      setRefreshing(false)
    }
  }, [refreshMessages])

  // Handle send message
  const handleSendMessage = useCallback(
    async (content: string) => {
      try {
        await sendMessage(content)
        setTimeout(scrollToBottom, 100)
      } catch (err) {
        console.error("Send message failed:", err)
      }
    },
    [sendMessage, scrollToBottom],
  )

  // Handle new session
  const handleNewSession = useCallback(async () => {
    try {
      await sessionManager.navigateToNewSession()
    } catch (error) {
      console.error("Failed to create new session:", error)
    }
  }, [sessionManager])

  // Render empty state
  const renderEmptyState = useCallback(
    () => (
      <Box center p="lg" m="md" style={{ transform: [{ scaleY: -1 }] }}>
        <Box center p="lg" background="subtle" rounded="lg" border="subtle" gap="md">
          <Icon icon={Feather} name="message-square" size={48} color="muted" />
          <Box center gap="xs">
            <Text mode="subtle" size="md" weight="medium">
              No messages yet
            </Text>
            <Text mode="subtle" size="sm" style={{ textAlign: "center", lineHeight: 18 }}>
              Start the conversation with OpenCode
            </Text>
          </Box>
        </Box>
      </Box>
    ),
    [],
  )

  // Render message item
  const renderItem = useCallback(({ item }: { item: any }) => <EnhancedMessageItem message={item} />, [])

  // Optimized item layout
  const getItemLayout = useCallback(
    (_data: any, index: number) => ({
      length: 80,
      offset: 80 * index,
      index,
    }),
    [],
  )

  // Error banner component
  const ErrorBanner = useCallback(() => {
    if (!error) return null

    return (
      <Box p="md" background="lighter" m="md" rounded="md" gap="sm">
        <Box direction="row" center gap="sm">
          <Icon icon={Feather} name="alert-circle" size={16} color="muted" />
          <Text mode="subtle" size="sm" weight="medium" style={{ flex: 1 }}>
            Connection issue - some messages may not load
          </Text>
        </Box>
        <Box direction="row" gap="sm">
          <Text mode="subtle" size="xs" style={{ opacity: 0.7 }}>
            {error.length > 50 ? error.substring(0, 50) + "..." : error}
          </Text>
        </Box>
      </Box>
    )
  }, [error, onRefresh])
  // Show loading state
  if (isLoading) {
    return (
      <Box flex background="base">
        <ChatHeader sessionTitle={session?.title} />
        <Box flex center>
          <Box animation="pulse" animationConfig={{ repeat: 3 }}>
            <Text mode="subtle">Loading messages...</Text>
          </Box>
        </Box>
        <MessageInput onSend={handleSendMessage} />
      </Box>
    )
  }

  const reversedMessages = [...messages].reverse()

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <Box flex background="base">
        <ErrorBanner />
        <Box flex>
          <MemoizedFlatList
            ref={flatListRef}
            data={reversedMessages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            inverted
            ListEmptyComponent={renderEmptyState}
            ListHeaderComponent={<TypingIndicator isVisible={isStreaming} />}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} style={{ transform: [{ scaleY: -1 }] }} />
            }
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              flexGrow: 1,
              paddingTop: 100,
              paddingBottom: Math.max(100, keyboardHeight + 20),
            }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScrollBeginDrag={() => {
              Keyboard.dismiss()
            }}
            maintainVisibleContentPosition={{
              minIndexForVisible: 0,
              autoscrollToTopThreshold: 10,
            }}
            removeClippedSubviews={true}
            maxToRenderPerBatch={10}
            windowSize={10}
            initialNumToRender={10}
            getItemLayout={getItemLayout}
          />
        </Box>
        <ChatHeader sessionTitle={session?.title} onNewSessionPress={handleNewSession} />
        <MessageInput onSend={handleSendMessage} disabled={isStreaming} />
      </Box>
    </KeyboardAvoidingView>
  )
}
