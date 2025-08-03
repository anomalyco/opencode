import { useState, useRef, useEffect, useCallback, memo } from "react"
import { FlatList, RefreshControl, Platform, KeyboardAvoidingView, Keyboard } from "react-native"
import { Box, Text, Icon } from "@/components/ui/primitives"
import { ChatHeader, MessageInput, TypingIndicator, EnhancedMessageItem } from "@/components/molecules/chat"
import { useSessionManager } from "@/services/session-manager"
import { Feather } from "@expo/vector-icons"
import {
  useLocalMessagesQuery,
  useUpsertLocalMessageMutation,
  useUpsertLocalMessagePartMutation,
} from "@/services/api/local/messages"
import { useSendRemoteMessageMutation, useRemoteMessagesQuery } from "@/services/api/remote/messages"
import { useLocalSessionQuery } from "@/services/api/local/sessions"
import { useLocalUserSettingsQuery } from "@/services/api/local/config"
import { useStreaming } from "@/services/api/remote/streaming"

interface ChatPageProps {
  sessionId: string
}

// Memoized FlatList for performance
const MemoizedFlatList = memo(FlatList<any>)

export const ChatPage = ({ sessionId }: ChatPageProps) => {
  const [refreshing, setRefreshing] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const flatListRef = useRef<FlatList>(null)
  const streamingTimeoutRef = useRef<number | null>(null)
  const [pendingUserMessages, setPendingUserMessages] = useState<Map<string, string>>(new Map())
  const sessionManager = useSessionManager()

  const { data: session } = useLocalSessionQuery(sessionId)
  const { data: messages, isLoading, refetch: refetchMessages } = useLocalMessagesQuery(sessionId)
  const { data: remoteMessages } = useRemoteMessagesQuery(sessionId)
  const { data: userSettings } = useLocalUserSettingsQuery()
  const sendMessage = useSendRemoteMessageMutation()
  const upsertLocalMessage = useUpsertLocalMessageMutation()
  const upsertLocalMessagePart = useUpsertLocalMessagePartMutation()
  const streaming = useStreaming()

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true })
  }, [])

  // Keyboard-aware scrolling
  useEffect(() => {
    const keyboardWillShow = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (event) => {
        setKeyboardHeight(event.endCoordinates.height)
        // Auto-scroll to bottom when keyboard appears
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

  // Sync remote messages to local database
  useEffect(() => {
    if (remoteMessages && remoteMessages.length > 0) {
      remoteMessages.forEach(async (remoteMessage) => {
        const localMessage = {
          id: remoteMessage.info.id,
          sessionId: remoteMessage.info.sessionID,
          role: remoteMessage.info.role,
          timeCreated: new Date(remoteMessage.info.time.created),
          timeCompleted: null,
          providerId: null,
          modelId: null,
          mode: null,
          pathCwd: null,
          pathRoot: null,
          isSummary: false,
          cost: 0,
          tokensInput: 0,
          tokensOutput: 0,
          tokensReasoning: 0,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          errorName: null,
          errorMessage: null,
          errorData: null,
          systemPrompts: null,
          isSynced: true,
          lastSyncTimestamp: new Date(),
        }

        try {
          await upsertLocalMessage.mutateAsync(localMessage)
          setPendingUserMessages((prev) => {
            const newMap = new Map(prev)
            newMap.delete(remoteMessage.info.id)
            return newMap
          })
        } catch (error) {
          // Failed to sync message
        }
      })
    }
  }, [remoteMessages])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear any pending timeouts
      if (streamingTimeoutRef.current) {
        clearTimeout(streamingTimeoutRef.current)
      }
      // Reset streaming state
      setIsStreaming(false)
    }
  }, [])

  // Connect to streaming and listen for message updates
  useEffect(() => {
    if (!streaming.isConnected()) {
      streaming.connect()
    }

    const unsubscribe = streaming.subscribe("*", (event) => {
      let eventSessionId: string | undefined
      if (event.type === "storage.write") {
        eventSessionId = (event as any).properties?.content?.sessionID
      } else if (event.type === "message.updated") {
        eventSessionId = (event as any).properties?.info?.sessionID
      } else if (event.type === "message.part.updated") {
        eventSessionId = (event as any).properties?.part?.sessionID
      } else if (event.type === "session.idle") {
        eventSessionId = (event as any).properties?.sessionID
      }

      if (eventSessionId !== sessionId) return

      if (event.type === "session.idle") {
        setIsStreaming(false)
        if (streamingTimeoutRef.current) {
          clearTimeout(streamingTimeoutRef.current)
          streamingTimeoutRef.current = null
        }
        refetchMessages()
        // Scroll to bottom when streaming completes
        setTimeout(scrollToBottom, 200)
      } else if (event.type === "storage.write") {
        const key = (event as any).properties?.key
        const content = (event as any).properties?.content

        if (key?.includes("step-start")) {
          setIsStreaming(true)
        } else if (key?.includes("/message/") && content?.role) {
          const existingMessage = messages?.find((m) => m.id === content.id)
          if (!existingMessage) {
            upsertLocalMessage.mutate({
              id: content.id,
              sessionId: content.sessionID,
              role: content.role,
              timeCreated: new Date(),
              timeCompleted: null,
              providerId: null,
              modelId: null,
              mode: null,
              pathCwd: null,
              pathRoot: null,
              isSummary: false,
              cost: 0,
              tokensInput: 0,
              tokensOutput: 0,
              tokensReasoning: 0,
              tokensCacheRead: 0,
              tokensCacheWrite: 0,
              errorName: null,
              errorMessage: null,
              errorData: null,
              systemPrompts: null,
              isSynced: false,
              lastSyncTimestamp: new Date(),
            })
          }
        } else if (key?.includes("/part/")) {
          // Handle different part types
          if (content?.type === "text") {
            upsertLocalMessagePart.mutate({
              id: content.id,
              sessionId: content.sessionID,
              messageId: content.messageID,
              type: "text",
              textContent: content.text || "",
              isSynthetic: content.synthetic || false,
              timeStart: content.time?.start ? new Date(content.time.start) : new Date(),
              timeEnd: content.time?.end ? new Date(content.time.end) : null,
              isSynced: true,
              lastSyncTimestamp: new Date(),
              fileMime: null,
              fileFilename: null,
              fileUrl: null,
              fileSourceType: null,
              fileSourcePath: null,
              fileSourceTextValue: null,
              fileSourceTextStart: null,
              fileSourceTextEnd: null,
              fileSourceName: null,
              fileSourceKind: null,
              fileSourceRange: null,
              toolCallId: null,
              toolName: null,
              toolStatus: null,
              toolInput: null,
              toolOutput: null,
              toolTitle: null,
              toolMetadata: null,
              toolError: null,
              toolTimeStart: null,
              toolTimeEnd: null,
              stepCost: null,
              stepTokensInput: null,
              stepTokensOutput: null,
              stepTokensReasoning: null,
              stepTokensCacheRead: null,
              stepTokensCacheWrite: null,
              snapshotId: null,
              patchHash: null,
              patchFiles: null,
            })
          } else if (content?.type === "tool") {
            upsertLocalMessagePart.mutate({
              id: content.id,
              sessionId: content.sessionID,
              messageId: content.messageID,
              type: "tool",
              textContent: null,
              isSynthetic: false,
              timeStart: content.state?.time?.start ? new Date(content.state.time.start) : new Date(),
              timeEnd: content.state?.time?.end ? new Date(content.state.time.end) : null,
              isSynced: true,
              lastSyncTimestamp: new Date(),
              fileMime: null,
              fileFilename: null,
              fileUrl: null,
              fileSourceType: null,
              fileSourcePath: null,
              fileSourceTextValue: null,
              fileSourceTextStart: null,
              fileSourceTextEnd: null,
              fileSourceName: null,
              fileSourceKind: null,
              fileSourceRange: null,
              toolCallId: content.callID,
              toolName: content.tool,
              toolStatus: content.state?.status || "pending",
              toolInput: content.state?.input ? JSON.stringify(content.state.input) : null,
              toolOutput: content.state?.output || null,
              toolTitle: content.state?.title || null,
              toolMetadata: content.state?.metadata ? JSON.stringify(content.state.metadata) : null,
              toolError: content.state?.error || null,
              toolTimeStart: content.state?.time?.start ? new Date(content.state.time.start) : null,
              toolTimeEnd: content.state?.time?.end ? new Date(content.state.time.end) : null,
              stepCost: null,
              stepTokensInput: null,
              stepTokensOutput: null,
              stepTokensReasoning: null,
              stepTokensCacheRead: null,
              stepTokensCacheWrite: null,
              snapshotId: null,
              patchHash: null,
              patchFiles: null,
            })
          } else if (content?.type === "file") {
            upsertLocalMessagePart.mutate({
              id: content.id,
              sessionId: content.sessionID,
              messageId: content.messageID,
              type: "file",
              textContent: null,
              isSynthetic: false,
              timeStart: new Date(),
              timeEnd: null,
              isSynced: true,
              lastSyncTimestamp: new Date(),
              fileMime: content.mime,
              fileFilename: content.filename,
              fileUrl: content.url,
              fileSourceType: content.source?.type,
              fileSourcePath: content.source?.path,
              fileSourceTextValue: content.source?.text?.value,
              fileSourceTextStart: content.source?.text?.start,
              fileSourceTextEnd: content.source?.text?.end,
              fileSourceName: content.source?.name,
              fileSourceKind: content.source?.kind,
              fileSourceRange: content.source?.range ? JSON.stringify(content.source.range) : null,
              toolCallId: null,
              toolName: null,
              toolStatus: null,
              toolInput: null,
              toolOutput: null,
              toolTitle: null,
              toolMetadata: null,
              toolError: null,
              toolTimeStart: null,
              toolTimeEnd: null,
              stepCost: null,
              stepTokensInput: null,
              stepTokensOutput: null,
              stepTokensReasoning: null,
              stepTokensCacheRead: null,
              stepTokensCacheWrite: null,
              snapshotId: null,
              patchHash: null,
              patchFiles: null,
            })
          }
        }
      }
    })
    return () => {
      unsubscribe()
      // Clean up streaming timeout on unmount
      if (streamingTimeoutRef.current) {
        clearTimeout(streamingTimeoutRef.current)
        streamingTimeoutRef.current = null
      }
    }
  }, [sessionId, scrollToBottom])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refetchMessages()
    } finally {
      setRefreshing(false)
    }
  }, [refetchMessages])

  const handleSendMessage = useCallback(
    async (content: string) => {
      try {
        setIsStreaming(true)

        if (streamingTimeoutRef.current) {
          clearTimeout(streamingTimeoutRef.current)
        }
        streamingTimeoutRef.current = setTimeout(() => {
          setIsStreaming(false)
        }, 30000)

        const providerID = userSettings?.defaultProviderId || "anthropic"
        const modelID = userSettings?.defaultModelId || "claude-sonnet-4-20250514"

        await sendMessage.mutateAsync({
          sessionId,
          data: {
            providerID,
            modelID,
            parts: [
              {
                type: "text",
                text: content,
              },
            ],
          },
        })

        // Scroll to bottom after sending message
        setTimeout(scrollToBottom, 100)
      } catch (error) {
        setIsStreaming(false)
      }
    },
    [sessionId, userSettings, sendMessage],
  )

  const handleNewSession = useCallback(async () => {
    try {
      await sessionManager.navigateToNewSession()
    } catch (error) {
      console.error("Failed to create new session:", error)
    }
  }, [sessionManager])

  const renderEmptyState = useCallback(
    () => (
      <Box center p="lg" m="md">
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

  const renderItem = useCallback(
    ({ item }: { item: any }) => (
      <EnhancedMessageItem
        message={item}
        remoteMessages={remoteMessages}
        localContent={pendingUserMessages.get(item.id)}
      />
    ),
    [remoteMessages, pendingUserMessages],
  )

  const getItemLayout = useCallback(
    (_data: any, index: number) => ({
      length: 80, // Estimated item height
      offset: 80 * index,
      index,
    }),
    [],
  )

  // Using TypingIndicator molecule now

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

  const reversedMessages = [...(messages || [])].reverse()

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <Box flex background="base">
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
        <MessageInput onSend={handleSendMessage} />
      </Box>
    </KeyboardAvoidingView>
  )
}
