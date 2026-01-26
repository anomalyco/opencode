import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native"
import { useLocalSearchParams, Stack, useRouter } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type BottomSheet from "@gorhom/bottom-sheet"
import {
  MessageBubble,
  PermissionPrompt,
  QuestionPrompt,
  StatusIndicator,
  SlashPopover,
  ModelPicker,
  type SlashCommand,
} from "../../src/components/chat"
import { useSessions } from "../../src/stores/sessions"
import { useEvents } from "../../src/stores/events"
import { useConnections } from "../../src/stores/connections"
import { useAuth } from "../../src/stores/auth"
import { useCatalog } from "../../src/stores/catalog"

// --- Builtin slash commands ---
const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    trigger: "new",
    title: "New Session",
    description: "Start a new session",
    icon: "add-circle-outline",
    type: "builtin",
  },
  {
    trigger: "model",
    title: "Switch Model",
    description: "Choose a different model",
    icon: "hardware-chip-outline",
    type: "builtin",
  },
  {
    trigger: "agent",
    title: "Switch Agent",
    description: "Cycle to next agent",
    icon: "person-outline",
    type: "builtin",
  },
  {
    trigger: "compact",
    title: "Compact",
    description: "Summarize conversation",
    icon: "contract-outline",
    type: "builtin",
  },
  { trigger: "clear", title: "Clear", description: "Clear the session", icon: "trash-outline", type: "builtin" },
]

function getShortDir(dir?: string): string | null {
  if (!dir) return null
  const parts = dir.split("/").filter(Boolean)
  return parts[parts.length - 1] || null
}

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const insets = useSafeAreaInsets()

  const flatListRef = useRef<FlatList>(null)
  const modelSheetRef = useRef<BottomSheet>(null)
  const [input, setInput] = useState("")

  const { currentSession, messages, parts, isLoading, isSending, selectSession, sendMessage, abortSession } =
    useSessions()

  const { authenticateForMessage } = useAuth()
  const { client } = useConnections()

  // Catalog
  const catalog = useCatalog()
  const agents = Array.isArray(catalog.agents) ? catalog.agents : []
  const serverCommands = Array.isArray(catalog.commands) ? catalog.commands : []
  const providers = Array.isArray(catalog.providers) ? catalog.providers : []
  const agent = catalog.agent || ""
  const model = catalog.model
  const setModel = catalog.setModel
  const cycleAgent = catalog.cycleAgent

  // Permission & question state
  const sessionID = currentSession?.id
  const permissions = useEvents((s) => (sessionID ? s.permissions[sessionID] : undefined)) || []
  const questions = useEvents((s) => (sessionID ? s.questions[sessionID] : undefined)) || []

  const shortDir = getShortDir(currentSession?.directory)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const initialScrollUntil = useRef(0)
  const prevMessageCount = useRef(0)
  const userHasScrolled = useRef(false)

  // Slash command state
  const slashActive = input.startsWith("/") && !input.includes(" ")
  const slashQuery = slashActive ? input.slice(1) : ""

  const allCommands = useMemo<SlashCommand[]>(() => {
    const custom: SlashCommand[] = serverCommands.map((cmd) => ({
      trigger: cmd.name,
      title: cmd.name,
      description: cmd.description,
      icon: "code-slash-outline",
      type: "custom",
    }))
    return [...custom, ...BUILTIN_COMMANDS]
  }, [serverCommands])

  const messageData = (messages || []).map((msg) => ({
    message: msg,
    parts: (parts && parts[msg.id]) || [],
  }))

  const scrollToBottom = useCallback((animated = true) => {
    flatListRef.current?.scrollToOffset({ offset: 999999, animated })
  }, [])

  useEffect(() => {
    if (id) {
      initialScrollUntil.current = Date.now() + 2000
      prevMessageCount.current = 0
      userHasScrolled.current = false
      selectSession(id)
    }
  }, [id])

  // Sync model chip from latest assistant message
  useEffect(() => {
    if (!messages || messages.length === 0) return
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === "assistant" && msg.providerID && msg.modelID) {
        setModel({ providerID: msg.providerID, modelID: msg.modelID })
        return
      }
      if (msg.role === "user" && msg.model) {
        setModel(msg.model)
        return
      }
    }
  }, [currentSession?.id, messages?.length])

  useEffect(() => {
    const count = messages?.length || 0
    if (count > prevMessageCount.current && prevMessageCount.current > 0 && !isLoading) {
      scrollToBottom(true)
    }
    prevMessageCount.current = count
  }, [messages?.length])

  // Slash command handler
  const handleSlashSelect = useCallback(
    (cmd: SlashCommand) => {
      if (cmd.type === "builtin") {
        switch (cmd.trigger) {
          case "new":
            router.back()
            return
          case "model":
            setInput("")
            modelSheetRef.current?.expand()
            return
          case "agent":
            setInput("")
            cycleAgent()
            return
          case "compact":
            setInput("")
            return
          case "clear":
            setInput("")
            return
        }
      }
      setInput(`/${cmd.trigger} `)
    },
    [router, cycleAgent],
  )

  const handleSend = async () => {
    if (!input.trim()) return
    const authenticated = await authenticateForMessage()
    if (!authenticated) return

    const text = input.trim()
    setInput("")

    if (isSending) {
      await abortSession()
      await new Promise((r) => setTimeout(r, 300))
    }

    // Server slash commands
    if (text.startsWith("/")) {
      const [cmdName, ...args] = text.split(" ")
      const name = cmdName.slice(1)
      const match = serverCommands.find((c) => c.name === name)
      if (match && client && currentSession) {
        client.session
          .command(currentSession.id, {
            command: name,
            arguments: args.join(" "),
            agent,
            model: model ? `${model.providerID}/${model.modelID}` : undefined,
          })
          .catch((err) => console.error("Command failed:", err))
        return
      }
    }

    await sendMessage(text, model || undefined, agent || undefined)
  }

  const handleScroll = useCallback((event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height
    setShowScrollButton(distanceFromBottom > 200)
    if (Date.now() < initialScrollUntil.current && distanceFromBottom > 300) {
      userHasScrolled.current = true
    }
  }, [])

  const handleContentSizeChange = useCallback(
    (_w: number, h: number) => {
      if (h <= 0) return
      if (Date.now() < initialScrollUntil.current && !userHasScrolled.current) {
        scrollToBottom(false)
        return
      }
      if (isSending) scrollToBottom(true)
    },
    [isSending, scrollToBottom],
  )

  const handlePermissionReply = async (requestID: string, reply: "once" | "always" | "reject") => {
    if (!client) return
    client.permission.reply(requestID, reply).catch((err) => console.error("Permission reply failed:", err))
  }

  const handleQuestionReply = async (requestID: string, answers: string[][]) => {
    if (!client) return
    client.question.reply(requestID, answers).catch((err) => console.error("Question reply failed:", err))
  }

  const handleQuestionReject = async (requestID: string) => {
    if (!client) return
    client.question.reject(requestID).catch((err) => console.error("Question reject failed:", err))
  }

  const handleModelSelect = useCallback(
    (providerID: string, modelID: string) => {
      setModel({ providerID, modelID })
    },
    [setModel],
  )

  // Current agent display
  const currentAgent = agents.find((a) => a.name === agent)
  const agentColor = currentAgent?.color || "#8b5cf6"
  const modelLabel = model?.modelID ? model.modelID.split("/").pop() || model.modelID : "default"

  return (
    <>
      <Stack.Screen
        options={{
          title: currentSession?.title || "Session",
          headerRight: () => (
            <View style={s.headerRight}>
              {shortDir && (
                <View style={[s.dirBadge, isDark && s.dirBadgeDark]}>
                  <Ionicons name="folder-outline" size={14} color={isDark ? "#888888" : "#666666"} />
                  <Text style={[s.dirText, isDark && s.dirTextDark]}>{shortDir}</Text>
                </View>
              )}
            </View>
          ),
        }}
      />

      <KeyboardAvoidingView
        style={[s.container, isDark && s.containerDark]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        {isLoading ? (
          <View style={s.loading}>
            <ActivityIndicator size="large" color={isDark ? "#ffffff" : "#0a0a0a"} />
          </View>
        ) : (
          <View style={s.listWrap}>
            <FlatList
              ref={flatListRef}
              data={messageData}
              keyExtractor={(item) => item.message.id}
              renderItem={({ item }) => <MessageBubble message={item.message} parts={item.parts} isDark={isDark} />}
              contentContainerStyle={s.messageList}
              onScroll={handleScroll}
              scrollEventThrottle={100}
              onContentSizeChange={handleContentSizeChange}
              ListEmptyComponent={
                <View style={s.empty}>
                  <Ionicons name="chatbubble-outline" size={48} color={isDark ? "#444444" : "#cccccc"} />
                  <Text style={[s.emptyText, isDark && s.metaDark]}>Start a conversation</Text>
                  <Text style={[s.emptyHint, isDark && s.metaDark]}>Type / for commands</Text>
                </View>
              }
            />
            {showScrollButton && (
              <TouchableOpacity style={[s.scrollBtn, isDark && s.scrollBtnDark]} onPress={() => scrollToBottom(true)}>
                <Ionicons name="chevron-down" size={24} color={isDark ? "#ffffff" : "#0a0a0a"} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Status */}
        {currentSession && <StatusIndicator sessionID={currentSession.id} isDark={isDark} />}

        {/* Permissions */}
        {permissions.map((perm) => (
          <PermissionPrompt
            key={perm.id}
            permission={perm}
            isDark={isDark}
            onReply={(reply) => handlePermissionReply(perm.id, reply)}
          />
        ))}

        {/* Questions */}
        {questions.map((q) => (
          <QuestionPrompt
            key={q.id}
            request={q}
            isDark={isDark}
            onReply={(answers) => handleQuestionReply(q.id, answers)}
            onReject={() => handleQuestionReject(q.id)}
          />
        ))}

        {/* Slash popover */}
        {slashActive && (
          <SlashPopover query={slashQuery} commands={allCommands} isDark={isDark} onSelect={handleSlashSelect} />
        )}

        {/* Agent/model toolbar */}
        <View style={[s.toolbar, isDark && s.toolbarDark]}>
          <TouchableOpacity
            style={[s.agentChip, { borderColor: agentColor }]}
            onPress={() => cycleAgent()}
            onLongPress={() => cycleAgent(-1)}
          >
            <View style={[s.agentDot, { backgroundColor: agentColor }]} />
            <Text style={[s.agentLabel, isDark && s.textWhite]}>{agent || "build"}</Text>
            <Ionicons name="swap-horizontal-outline" size={12} color={isDark ? "#888888" : "#666666"} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.modelChip, isDark && s.modelChipDark]}
            onPress={() => modelSheetRef.current?.expand()}
          >
            <Ionicons name="hardware-chip-outline" size={14} color={isDark ? "#888888" : "#666666"} />
            <Text style={[s.modelLabel, isDark && s.metaDark]} numberOfLines={1}>
              {modelLabel}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Input */}
        <View
          style={[s.inputContainer, isDark && s.inputContainerDark, { paddingBottom: Math.max(12, insets.bottom) }]}
        >
          <TextInput
            style={[s.input, isDark && s.inputDark]}
            placeholder={isSending ? "Type to interrupt..." : "Type a message..."}
            placeholderTextColor={isDark ? "#666666" : "#999999"}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={10000}
          />
          {isSending && !input.trim() ? (
            <TouchableOpacity style={s.stopBtn} onPress={abortSession}>
              <Ionicons name="stop" size={20} color="#ffffff" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[s.sendBtn, !input.trim() && s.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!input.trim()}
            >
              <Ionicons name={isSending ? "arrow-up" : "send"} size={20} color="#ffffff" />
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Model picker bottom sheet */}
      <ModelPicker
        sheetRef={modelSheetRef}
        providers={providers}
        selected={model}
        isDark={isDark}
        onSelect={handleModelSelect}
      />
    </>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },
  loading: { flex: 1, justifyContent: "center", alignItems: "center" },
  listWrap: { flex: 1, position: "relative" },

  // Messages
  messageList: { padding: 16, paddingBottom: 8 },

  // Scroll button
  scrollBtn: {
    position: "absolute",
    bottom: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  scrollBtnDark: { backgroundColor: "#2a2a2a" },

  // Empty
  empty: { flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: 64 },
  emptyText: { fontSize: 16, color: "#999999", marginTop: 12 },
  emptyHint: { fontSize: 13, color: "#bbbbbb", marginTop: 4 },
  metaDark: { color: "#666666" },
  textWhite: { color: "#ffffff" },

  // Toolbar
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    backgroundColor: "#ffffff",
  },
  toolbarDark: { borderTopColor: "#1a1a1a", backgroundColor: "#0a0a0a" },
  agentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  agentDot: { width: 8, height: 8, borderRadius: 4 },
  agentLabel: { fontSize: 12, fontWeight: "600", color: "#0a0a0a" },
  modelChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#f5f5f5",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  modelChipDark: { backgroundColor: "#1a1a1a" },
  modelLabel: { fontSize: 12, color: "#666666", maxWidth: 160 },

  // Input
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    backgroundColor: "#ffffff",
  },
  inputContainerDark: { borderTopColor: "#1a1a1a", backgroundColor: "#0a0a0a" },
  input: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 120,
    color: "#0a0a0a",
  },
  inputDark: { backgroundColor: "#1a1a1a", color: "#ffffff" },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#0a0a0a",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  sendBtnDisabled: { backgroundColor: "#cccccc" },
  stopBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },

  // Header
  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  dirBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#f5f5f5",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  dirBadgeDark: { backgroundColor: "#1a1a1a" },
  dirText: { fontSize: 12, color: "#666666", fontWeight: "500" },
  dirTextDark: { color: "#888888" },
})
