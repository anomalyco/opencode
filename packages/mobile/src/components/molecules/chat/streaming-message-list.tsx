/**
 * Streaming Message List - Handles streaming state internally
 * Prevents parent component re-renders during streaming
 */

import { memo, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react"
import { FlatList, Keyboard, RefreshControl } from "react-native"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { TypingIndicator, EnhancedMessageItem } from "@/components/molecules/chat"

import { Feather } from "@expo/vector-icons"
import { useChatState } from "@/hooks/use-chat-state"

interface StreamingMessageListProps {
  sessionId: string
  keyboardHeight: number
  onRefresh: () => Promise<void>
  refreshing: boolean
  currentMode?: string
}

export interface StreamingMessageListRef {
  scrollToBottom: () => void
}

// Memoized FlatList for performance
const MemoizedFlatList = memo(FlatList<any>)

export const StreamingMessageList = memo(
  forwardRef<StreamingMessageListRef, StreamingMessageListProps>(
    ({ sessionId, keyboardHeight, onRefresh, refreshing, currentMode }, ref) => {
      const flatListRef = useRef<FlatList>(null)

      // All streaming state is contained here - won't affect parent
      const { messages, isLoading, isStreaming, error, refreshMessages } = useChatState(sessionId)

      // Scroll to bottom helper
      const scrollToBottom = useCallback(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true })
      }, [])

      // Expose scrollToBottom to parent
      useImperativeHandle(ref, () => ({
        scrollToBottom,
      }))

      // Auto-scroll when streaming completes
      useEffect(() => {
        if (!isStreaming && messages.length > 0) {
          setTimeout(scrollToBottom, 200)
        }
      }, [isStreaming, messages.length, scrollToBottom])

      // Handle refresh with internal state
      const handleRefresh = useCallback(async () => {
        try {
          await refreshMessages()
          await onRefresh()
        } catch (err) {
          // Handle error silently
        }
      }, [refreshMessages, onRefresh])

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
      }, [error])

      // Show loading state
      if (isLoading) {
        return (
          <Box flex center>
            <Box animation="pulse" animationConfig={{ repeat: 3 }}>
              <Text mode="subtle">Loading messages...</Text>
            </Box>
          </Box>
        )
      }

      const reversedMessages = [...messages].reverse()

      return (
        <Box flex>
          <ErrorBanner />
          <MemoizedFlatList
            ref={flatListRef}
            data={reversedMessages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            inverted
            ListEmptyComponent={renderEmptyState}
            ListHeaderComponent={<TypingIndicator isVisible={isStreaming} />}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                title={`Pull to switch to ${currentMode === "plan" ? "build" : "plan"} mode`}
              />
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
            maxToRenderPerBatch={8}
            windowSize={8}
            initialNumToRender={8}
            updateCellsBatchingPeriod={100}
            disableVirtualization={false}
            legacyImplementation={false}
          />
        </Box>
      )
    },
  ),
)

StreamingMessageList.displayName = "StreamingMessageList"
