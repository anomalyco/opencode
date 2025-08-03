import { useState, useRef, useEffect } from "react"
import { FlatList, RefreshControl } from "react-native"
import { KeyboardAvoidingView } from "react-native-keyboard-controller"
import { ThemedMarked } from "@/components/ui/primitives/marked"
import { Box, Text, Button, Input } from "@/components/ui/primitives"
import {
  useLocalMessagesQuery,
  useUpsertLocalMessageMutation,
  useUpsertLocalMessagePartMutation,
  useLocalMessagePartsQuery,
} from "@/services/api/local/messages"
import { useSendRemoteMessageMutation, useRemoteMessagesQuery } from "@/services/api/remote/messages"
import { useLocalSessionQuery } from "@/services/api/local/sessions"
import { useLocalUserSettingsQuery } from "@/services/api/local/config"
import { useStreaming } from "@/services/api/remote/streaming"

interface ChatPageProps {
  sessionId: string
}

interface MessageItemProps {
  message: {
    id: string
    role: "user" | "assistant"
    createdAt: Date
  }
  remoteMessages?: any[]
  localContent?: string
}

const MessageItem = ({ message, remoteMessages, localContent }: MessageItemProps) => {
  const isUser = message.role === "user"

  // Get message parts from local SQLite for real-time updates
  const { data: localMessageParts } = useLocalMessagePartsQuery(message.id)
  const localTextParts = localMessageParts?.filter((part) => part.type === "text" && !part.isSynthetic) || []
  const localTextContent = localTextParts.map((part) => part.textContent).join("\n")

  // Fallback to remote message if no local content
  const remoteMessage = remoteMessages?.find((rm) => rm.info.id === message.id)
  const remoteTextParts = remoteMessage?.parts?.filter((part: any) => part.type === "text" && !part.synthetic) || []
  const remoteTextContent = remoteTextParts.map((part: any) => part.text).join("\n")

  // Use local content first (for streaming), then provided localContent, then remote, then fallback
  const content = localTextContent || localContent || remoteTextContent

  // Don't render if no content
  if (!content) {
    return null
  }

  return (
    <Box p="md">
      <Box direction="row" justifyContent={isUser ? "flex-end" : "flex-start"}>
        <Box background={isUser ? "emphasis" : "subtle"} rounded="lg" p="md" style={{ maxWidth: "80%" }}>
          <ThemedMarked value={content} />
        </Box>
      </Box>
    </Box>
  )
}

const ChatHeader = ({ sessionTitle }: { sessionTitle?: string }) => {
  return (
    <Box
      direction="row"
      justifyContent="space-between"
      alignItems="center"
      p="md"
      border="subtle"
      background="base"
      safeAreaTop
    >
      <Box flex>
        <Text size="lg" weight="semibold" numberOfLines={1}>
          {sessionTitle || "Chat"}
        </Text>
      </Box>
      <Button size="sm" variant="ghost">
        <Box p="xs">
          <Text size="sm">⋯</Text>
        </Box>
      </Button>
    </Box>
  )
}

const MessageInput = ({ onSend, isLoading }: { onSend: (content: string) => void; isLoading: boolean }) => {
  const [messageText, setMessageText] = useState("")

  const handleSend = () => {
    if (messageText.trim()) {
      onSend(messageText.trim())
      setMessageText("")
    }
  }

  return (
    <Box direction="row" alignItems="flex-end" p="md" gap="sm" border="subtle" background="base" safeAreaBottom>
      <Box flex>
        <Input
          value={messageText}
          onChangeText={setMessageText}
          placeholder="Type a message..."
          multiline
          style={{ maxHeight: 100 }}
        />
      </Box>
      <Button
        size="auto"
        mode="brand"
        onPress={handleSend}
        loading={isLoading}
        style={{ paddingHorizontal: 16, paddingVertical: 12 }}
      >
        <Text size="sm" weight="medium" inverse>
          Send
        </Text>
      </Button>
    </Box>
  )
}

export const ChatPage = ({ sessionId }: ChatPageProps) => {
  const [refreshing, setRefreshing] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const flatListRef = useRef<FlatList>(null)
  const streamingTimeoutRef = useRef<number | null>(null)
  const [pendingUserMessages, setPendingUserMessages] = useState<Map<string, string>>(new Map())

  const { data: session } = useLocalSessionQuery(sessionId)
  const { data: messages, isLoading, refetch: refetchMessages } = useLocalMessagesQuery(sessionId)
  const { data: remoteMessages } = useRemoteMessagesQuery(sessionId)
  const { data: userSettings } = useLocalUserSettingsQuery()
  const sendMessage = useSendRemoteMessageMutation()
  const upsertLocalMessage = useUpsertLocalMessageMutation()
  const upsertLocalMessagePart = useUpsertLocalMessagePartMutation()
  const streaming = useStreaming()

  // Sync remote messages to local database
  useEffect(() => {
    if (remoteMessages && remoteMessages.length > 0) {
      remoteMessages.forEach(async (remoteMessage) => {
        // Get text content from parts

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
          // Clear pending content since it's now synced
          setPendingUserMessages((prev) => {
            const newMap = new Map(prev)
            newMap.delete(remoteMessage.info.id)
            return newMap
          })
        } catch (error) {
          console.error("❌ Chat: Failed to sync message", error)
        }
      })
    }
  }, [remoteMessages])

  // Connect to streaming and listen for message updates
  useEffect(() => {
    if (!streaming.isConnected()) {
      streaming.connect()
    }

    const unsubscribe = streaming.subscribe("*", (event) => {
      // Check if this event is for our session
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
      } else if (event.type === "storage.write") {
        const key = (event as any).properties?.key
        const content = (event as any).properties?.content

        if (key?.includes("step-start")) {
          setIsStreaming(true)
        } else if (key?.includes("/message/") && content?.role) {
          // Create message with role from backend
          const existingMessage = messages?.find((m) => m.id === content.id)
          if (!existingMessage) {
            upsertLocalMessage.mutate({
              id: content.id,
              sessionId: content.sessionID,
              role: content.role, // Use role from backend
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
        } else if (key?.includes("/part/") && content?.type === "text") {
          // Write text part to SQLite
          upsertLocalMessagePart.mutate({
            id: content.id,
            sessionId: content.sessionID,
            messageId: content.messageID,
            type: "text",
            textContent: content.text || "",
            isSynthetic: false,
            timeStart: content.time?.start ? new Date(content.time.start) : new Date(),
            timeEnd: content.time?.end ? new Date(content.time.end) : null,
            isSynced: true,
            lastSyncTimestamp: new Date(),
            // Set all other fields to null for text parts
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
        }
      } else if (event.type === "message.part.updated") {
        const part = (event as any).properties?.part
        if (part?.type === "text") {
          // Write text part to SQLite
          upsertLocalMessagePart.mutate({
            id: part.id,
            sessionId: part.sessionID,
            messageId: part.messageID,
            type: "text",
            textContent: part.text || "",
            isSynthetic: false,
            timeStart: part.time?.start ? new Date(part.time.start) : new Date(),
            timeEnd: part.time?.end ? new Date(part.time.end) : null,
            isSynced: true,
            lastSyncTimestamp: new Date(),
            // Set all other fields to null for text parts
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
        }
      }
    })
    return () => {
      unsubscribe()
    }
  }, [sessionId])

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await refetchMessages()
    } finally {
      setRefreshing(false)
    }
  }

  const handleSendMessage = async (content: string) => {
    try {
      console.log("💬 Sending message:", content)
      setIsStreaming(true)

      // Set a timeout to clear streaming state as fallback
      if (streamingTimeoutRef.current) {
        clearTimeout(streamingTimeoutRef.current)
      }
      streamingTimeoutRef.current = setTimeout(() => {
        console.log("💬 Streaming timeout - clearing loading state")
        setIsStreaming(false)
      }, 30000) // 30 second timeout

      // Don't create user message locally - let streaming handle it with correct role
      // Get default provider and model from user settings
      const providerID = userSettings?.defaultProviderId || "anthropic"
      const modelID = userSettings?.defaultModelId || "claude-sonnet-4-20250514"

      console.log("💬 Using provider:", providerID, "model:", modelID)

      const result = await sendMessage.mutateAsync({
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

      console.log("💬 Send message result:", result)

      // Scroll to bottom after sending
      setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true })
      }, 100)
    } catch (error) {
      console.error("💬 Failed to send message:", error)
      setIsStreaming(false)
    }
  }

  const renderEmptyState = () => (
    <Box center p="lg" style={{ transform: [{ scaleY: -1 }] }}>
      <Box center p="lg" background="subtle" rounded="lg" border="subtle">
        <Text mode="subtle" size="sm">
          Start the conversation
        </Text>
        <Box mt="xs">
          <Text mode="subtle" size="xs">
            Send your first message to begin
          </Text>
        </Box>
      </Box>
    </Box>
  )

  const renderTypingIndicator = () => {
    if (!isStreaming) return null

    return (
      <Box p="md" style={{ transform: [{ scaleY: -1 }] }}>
        <Box direction="row" justifyContent="flex-start">
          <Box background="subtle" rounded="lg" p="md" style={{ maxWidth: "80%" }}>
            <Box direction="row" alignItems="center" gap="xs">
              <Box animation="pulse" animationConfig={{ repeat: -1 }}>
                <Text size="md">●</Text>
              </Box>
              <Box animation="pulse" animationConfig={{ repeat: -1, delay: 200 }}>
                <Text size="md">●</Text>
              </Box>
              <Box animation="pulse" animationConfig={{ repeat: -1, delay: 400 }}>
                <Text size="md">●</Text>
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  if (isLoading) {
    return (
      <Box flex background="base">
        <ChatHeader sessionTitle={session?.title} />
        <Box flex center>
          <Box animation="pulse" animationConfig={{ repeat: 3 }}>
            <Text mode="subtle">Loading messages...</Text>
          </Box>
        </Box>
        <MessageInput onSend={handleSendMessage} isLoading={sendMessage.isPending} />
      </Box>
    )
  }

  // Reverse messages for inverted FlatList (newest at bottom)
  const reversedMessages = [...(messages || [])].reverse()

  return (
    <KeyboardAvoidingView style={{ flex: 1 }}>
      <Box flex background="base">
        <ChatHeader sessionTitle={session?.title} />

        <Box flex>
          <FlatList
            ref={flatListRef}
            data={reversedMessages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <MessageItem
                message={item}
                remoteMessages={remoteMessages}
                localContent={pendingUserMessages.get(item.id)}
              />
            )}
            inverted
            ListEmptyComponent={renderEmptyState}
            ListHeaderComponent={renderTypingIndicator}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} style={{ transform: [{ scaleY: -1 }] }} />
            }
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ flexGrow: 1 }}
          />
        </Box>

        <MessageInput onSend={handleSendMessage} isLoading={sendMessage.isPending} />
      </Box>
    </KeyboardAvoidingView>
  )
}
