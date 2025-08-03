import { useState, useRef, useEffect } from "react"
import { FlatList, RefreshControl } from "react-native"
import { KeyboardAvoidingView } from "react-native-keyboard-controller"
import { ThemedMarked } from "@/components/ui/primitives/marked"
import { Box, Text, Button, Input } from "@/components/ui/primitives"
import { useLocalMessagesQuery, useUpsertLocalMessageMutation } from "@/services/api/local/messages"
import { useSendRemoteMessageMutation, useRemoteMessagesQuery } from "@/services/api/remote/messages"
import { useLocalSessionQuery } from "@/services/api/local/sessions"

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
}

const MessageItem = ({ message, remoteMessages }: MessageItemProps) => {
  const isUser = message.role === "user"

  // Find the corresponding remote message to get the text content
  const remoteMessage = remoteMessages?.find((rm) => rm.info.id === message.id)
  const textParts = remoteMessage?.parts?.filter((part: any) => part.type === "text" && !part.synthetic) || []
  const content = textParts.map((part: any) => part.text).join("\n") || "No content"

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
  const flatListRef = useRef<FlatList>(null)

  const { data: session } = useLocalSessionQuery(sessionId)
  const { data: messages, isLoading, refetch: refetchMessages } = useLocalMessagesQuery(sessionId)
  const { data: remoteMessages } = useRemoteMessagesQuery(sessionId)
  const sendMessage = useSendRemoteMessageMutation()
  const upsertLocalMessage = useUpsertLocalMessageMutation()

  console.log("💬 Chat: sessionId", sessionId)
  console.log("💬 Chat: session", session?.title)
  console.log("💬 Chat: messages", { count: messages?.length, isLoading })
  console.log("💬 Chat: remoteMessages", { count: remoteMessages?.length })
  if (remoteMessages?.length) {
    console.log("💬 Chat: First remote message", JSON.stringify(remoteMessages[0], null, 2))
  }

  // Sync remote messages to local database
  useEffect(() => {
    if (remoteMessages && remoteMessages.length > 0) {
      console.log("💬 Chat: Syncing", remoteMessages.length, "remote messages")

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
          console.log("✅ Chat: Synced message", remoteMessage.info.id)
        } catch (error) {
          console.error("❌ Chat: Failed to sync message", error)
        }
      })
    }
  }, [remoteMessages])

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
      await sendMessage.mutateAsync({
        sessionId,
        data: { content },
      })
      // Scroll to bottom after sending
      setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true })
      }, 100)
    } catch (error) {
      console.error("Failed to send message:", error)
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
            renderItem={({ item }) => <MessageItem message={item} remoteMessages={remoteMessages} />}
            inverted
            ListEmptyComponent={renderEmptyState}
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
