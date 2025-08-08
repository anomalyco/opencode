/**
 * Streaming Message List - Simplified coordinator component
 */

import { memo, useRef, useCallback, forwardRef, useImperativeHandle, useMemo, useState } from "react"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { TypingIndicator } from "@/components/molecules/chat"
import { MessageListContainer, type MessageListContainerRef } from "./message-list-container"
import { useLocalSessionPartsQuery } from "@/services/api/local/messages"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/services/api/keys"
import { Feather } from "@expo/vector-icons"
import { useChatState } from "@/hooks/use-chat-state"

interface StreamingMessageListProps {
  sessionId: string
}

export interface StreamingMessageListRef {
  scrollToBottom: () => void
}

export const StreamingMessageList = memo(
  forwardRef<StreamingMessageListRef, StreamingMessageListProps>(({ sessionId }, ref) => {
    const listRef = useRef<MessageListContainerRef>(null)
    const [refreshing, setRefreshing] = useState(false)

    const { isStreaming, error } = useChatState(sessionId)
    const queryClient = useQueryClient()

    const { data: messagesWithParts, isLoading, refetch: refetchParts } = useLocalSessionPartsQuery(sessionId)

    const flattenedItems = useMemo(() => {
      if (!messagesWithParts) return []

      const items: any[] = []

      messagesWithParts.forEach((message: any) => {
        if (message.parts && Array.isArray(message.parts)) {
          message.parts.forEach((part: any, partIndex: number) => {
            items.push({
              type: "part",
              id: `part-${part.id}`,
              data: {
                ...part,
                role: message.role,
              },
              messageId: message.id,
              role: message.role,
              createdAt: part.createdAt,
              partIndex: partIndex,
            })
          })
        }
      })

      return items
    }, [messagesWithParts])

    const scrollToBottom = useCallback(() => {
      listRef.current?.scrollToBottom()
    }, [])

    useImperativeHandle(ref, () => ({
      scrollToBottom,
    }))

    const handleRefresh = useCallback(async () => {
      setRefreshing(true)
      try {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.local.sessions.detail(sessionId),
        })
        await queryClient.invalidateQueries({
          queryKey: queryKeys.local.messages.list(sessionId),
        })
      } catch {
        // Handle error silently
      } finally {
        setRefreshing(false)
      }
    }, [queryClient, sessionId])

    const handleRetry = useCallback(() => {
      refetchParts()
    }, [refetchParts])

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

    if (isLoading) {
      return (
        <Box flex center>
          <Box animation="pulse" animationConfig={{ repeat: 3 }}>
            <Text mode="subtle">Loading messages...</Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flex>
        <ErrorBanner />
        <MessageListContainer
          ref={listRef}
          items={flattenedItems}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          onRetry={handleRetry}
          ListHeaderComponent={<TypingIndicator isVisible={isStreaming} />}
        />
      </Box>
    )
  }),
)

StreamingMessageList.displayName = "StreamingMessageList"
