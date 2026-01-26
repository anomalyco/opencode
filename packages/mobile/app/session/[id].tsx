import { useEffect, useRef, useState, useCallback } from "react"
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
import { useLocalSearchParams, Stack } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { Markdown } from "../../src/components/markdown"
import { useSessions } from "../../src/stores/sessions"
import { useEvents } from "../../src/stores/events"
import { useConnections } from "../../src/stores/connections"
import { useAuth } from "../../src/stores/auth"
import type { Message, Part } from "../../src/lib/sdk"

// --- Tool icon mapping ---
const TOOL_ICONS: Record<string, string> = {
  read: "glasses-outline",
  list: "list-outline",
  glob: "search-outline",
  grep: "search-outline",
  webfetch: "globe-outline",
  edit: "code-slash-outline",
  write: "code-slash-outline",
  apply_patch: "code-slash-outline",
  bash: "terminal-outline",
  task: "git-branch-outline",
  todowrite: "checkbox-outline",
  todoread: "checkbox-outline",
  question: "chatbubble-ellipses-outline",
}

function ToolCallCard({ tool, isDark }: { tool: Part; isDark: boolean }) {
  const icon = (tool.tool && TOOL_ICONS[tool.tool]) || "extension-puzzle-outline"
  const status = tool.state?.status || "pending"

  const statusColor =
    status === "completed" ? "#22c55e" : status === "error" ? "#ef4444" : status === "running" ? "#f59e0b" : "#888888"

  return (
    <View style={[styles.toolCall, isDark && styles.toolCallDark]}>
      <View style={styles.toolHeader}>
        <Ionicons name={icon as any} size={16} color={statusColor} />
        <Text style={[styles.toolName, isDark && styles.textDark]} numberOfLines={1}>
          {tool.state?.title || tool.tool || "Tool"}
        </Text>
      </View>
      {status === "running" && <ActivityIndicator size="small" color={statusColor} />}
      {status === "completed" && <Ionicons name="checkmark-circle" size={16} color="#22c55e" />}
      {status === "error" && <Ionicons name="close-circle" size={16} color="#ef4444" />}
    </View>
  )
}

function MessageBubble({ message, parts, isDark }: { message: Message; parts: Part[]; isDark: boolean }) {
  const isUser = message.role === "user"

  const textParts = parts.filter((p) => p.type === "text")
  const reasoningParts = parts.filter((p) => p.type === "reasoning")
  const toolParts = parts.filter((p) => p.type === "tool")
  const text = textParts.map((p) => p.text).join("\n") || ""
  const reasoning = reasoningParts.map((p) => p.text).join("\n") || ""

  return (
    <View
      style={[
        styles.messageBubble,
        isUser ? styles.userBubble : styles.assistantBubble,
        isUser && isDark && styles.userBubbleDark,
        !isUser && isDark && styles.assistantBubbleDark,
      ]}
    >
      {/* Role indicator */}
      <View style={styles.messageHeader}>
        <Ionicons
          name={isUser ? "person" : "sparkles"}
          size={14}
          color={isUser ? (isDark ? "#ffffff" : "#0a0a0a") : "#8b5cf6"}
        />
        <Text style={[styles.messageRole, isUser && styles.userRole, isDark && styles.textDark]}>
          {isUser ? "You" : "Assistant"}
        </Text>
        {message.model && <Text style={[styles.modelTag, isDark && styles.metaDark]}>{message.model.modelID}</Text>}
      </View>

      {/* Reasoning (collapsible) */}
      {reasoning && <ReasoningBlock text={reasoning} isDark={isDark} />}

      {/* Message text - use StreamdownRN for assistant, plain for user */}
      {text &&
        (isUser ? (
          <Text style={[styles.messageText, isDark && styles.textDark]} selectable>
            {text}
          </Text>
        ) : (
          <View style={styles.markdownContainer}>
            <Markdown>{text}</Markdown>
          </View>
        ))}

      {/* Tool calls */}
      {toolParts.map((tool) => (
        <ToolCallCard key={tool.id} tool={tool} isDark={isDark} />
      ))}

      {/* Tokens/cost for assistant messages */}
      {!isUser && message.tokens && (
        <Text style={[styles.tokenInfo, isDark && styles.metaDark]}>
          {message.tokens.input + message.tokens.output} tokens
          {message.cost ? ` · $${message.cost.toFixed(4)}` : ""}
        </Text>
      )}
    </View>
  )
}

function ReasoningBlock({ text, isDark }: { text: string; isDark: boolean }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <TouchableOpacity
      style={[styles.reasoningBlock, isDark && styles.reasoningBlockDark]}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.7}
    >
      <View style={styles.reasoningHeader}>
        <Ionicons name="bulb-outline" size={14} color="#f59e0b" />
        <Text style={[styles.reasoningLabel, isDark && styles.metaDark]}>Thinking</Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={14} color={isDark ? "#666666" : "#999999"} />
      </View>
      {expanded && (
        <Text style={[styles.reasoningText, isDark && styles.metaDark]} selectable>
          {text}
        </Text>
      )}
    </TouchableOpacity>
  )
}

// --- Permission prompt ---
function PermissionPrompt({
  permission,
  isDark,
  onReply,
}: {
  permission: { id: string; permission: string; patterns: string[] }
  isDark: boolean
  onReply: (reply: "once" | "always" | "reject") => void
}) {
  return (
    <View style={[styles.permissionCard, isDark && styles.permissionCardDark]}>
      <View style={styles.permissionHeader}>
        <Ionicons name="shield-outline" size={18} color="#f59e0b" />
        <Text style={[styles.permissionTitle, isDark && styles.textDark]}>Permission Required</Text>
      </View>
      <Text style={[styles.permissionType, isDark && styles.metaDark]}>
        {permission.permission}: {permission.patterns.join(", ")}
      </Text>
      <View style={styles.permissionActions}>
        <TouchableOpacity style={[styles.permissionBtn, styles.permissionDeny]} onPress={() => onReply("reject")}>
          <Text style={styles.permissionDenyText}>Deny</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.permissionBtn, styles.permissionAlways, isDark && styles.permissionAlwaysDark]}
          onPress={() => onReply("always")}
        >
          <Text style={[styles.permissionAlwaysText, isDark && styles.textDark]}>Always</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.permissionBtn, styles.permissionAllow, isDark && styles.permissionAllowDark]}
          onPress={() => onReply("once")}
        >
          <Text style={[styles.permissionAllowText, isDark && styles.permissionAllowTextDark]}>Allow</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// --- Question prompt ---
function QuestionPrompt({
  request,
  isDark,
  onReply,
  onReject,
}: {
  request: {
    id: string
    questions: Array<{
      question: string
      header: string
      options: Array<{ label: string; description: string }>
      multiple?: boolean
      custom?: boolean
    }>
  }
  isDark: boolean
  onReply: (answers: string[][]) => void
  onReject: () => void
}) {
  const [answers, setAnswers] = useState<string[][]>(request.questions.map(() => []))
  const [customInput, setCustomInput] = useState("")
  const [showCustom, setShowCustom] = useState(false)
  const [currentQ, setCurrentQ] = useState(0)

  const q = request.questions[currentQ]
  if (!q) return null

  const toggleOption = (label: string) => {
    setAnswers((prev) => {
      const copy = [...prev]
      const current = copy[currentQ] || []
      if (q.multiple) {
        copy[currentQ] = current.includes(label) ? current.filter((a) => a !== label) : [...current, label]
      } else {
        copy[currentQ] = [label]
        // Auto-advance for single-select single-question
        if (request.questions.length === 1) {
          setTimeout(() => onReply(copy), 100)
        }
      }
      return copy
    })
  }

  const submitCustom = () => {
    if (!customInput.trim()) return
    const copy = [...answers]
    copy[currentQ] = [customInput.trim()]
    setAnswers(copy)
    setCustomInput("")
    setShowCustom(false)
    if (request.questions.length === 1) {
      onReply(copy)
    }
  }

  return (
    <View style={[styles.questionCard, isDark && styles.questionCardDark]}>
      <View style={styles.questionHeader}>
        <Ionicons name="chatbubble-ellipses-outline" size={18} color="#8b5cf6" />
        <Text style={[styles.questionTitle, isDark && styles.textDark]}>{q.header || "Question"}</Text>
      </View>
      <Text style={[styles.questionText, isDark && styles.textDark]}>{q.question}</Text>

      {/* Options */}
      <View style={styles.questionOptions}>
        {q.options.map((opt) => {
          const selected = (answers[currentQ] || []).includes(opt.label)
          return (
            <TouchableOpacity
              key={opt.label}
              style={[
                styles.questionOption,
                isDark && styles.questionOptionDark,
                selected && styles.questionOptionSelected,
                selected && isDark && styles.questionOptionSelectedDark,
              ]}
              onPress={() => toggleOption(opt.label)}
            >
              <Text
                style={[
                  styles.questionOptionLabel,
                  isDark && styles.textDark,
                  selected && styles.questionOptionLabelSelected,
                ]}
              >
                {opt.label}
              </Text>
              {opt.description && (
                <Text style={[styles.questionOptionDesc, isDark && styles.metaDark]}>{opt.description}</Text>
              )}
            </TouchableOpacity>
          )
        })}

        {/* Custom answer */}
        {q.custom !== false &&
          (showCustom ? (
            <View style={styles.questionCustomRow}>
              <TextInput
                style={[styles.questionCustomInput, isDark && styles.questionCustomInputDark]}
                placeholder="Type your answer..."
                placeholderTextColor={isDark ? "#666666" : "#999999"}
                value={customInput}
                onChangeText={setCustomInput}
                onSubmitEditing={submitCustom}
                autoFocus
              />
              <TouchableOpacity onPress={submitCustom} style={styles.questionCustomSubmit}>
                <Ionicons name="send" size={18} color="#8b5cf6" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.questionOption, isDark && styles.questionOptionDark]}
              onPress={() => setShowCustom(true)}
            >
              <Text style={[styles.questionOptionLabel, { color: "#8b5cf6" }]}>Type your own answer</Text>
            </TouchableOpacity>
          ))}
      </View>

      {/* Multi-question navigation / submit */}
      <View style={styles.questionFooter}>
        <TouchableOpacity onPress={onReject}>
          <Text style={[styles.questionDismiss, isDark && styles.metaDark]}>Dismiss</Text>
        </TouchableOpacity>
        {(request.questions.length > 1 || q.multiple) && (
          <TouchableOpacity
            style={[styles.questionSubmitBtn, isDark && styles.questionSubmitBtnDark]}
            onPress={() => {
              if (currentQ < request.questions.length - 1) {
                setCurrentQ(currentQ + 1)
              } else {
                onReply(answers)
              }
            }}
          >
            <Text style={[styles.questionSubmitText, isDark && styles.questionSubmitTextDark]}>
              {currentQ < request.questions.length - 1 ? "Next" : "Submit"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

// --- Status bar ---
function StatusIndicator({ sessionID, isDark }: { sessionID: string; isDark: boolean }) {
  const status = useEvents((s) => s.sessionStatus[sessionID])
  const text = useEvents((s) => s.statusText[sessionID])

  if (!status || status.type === "idle") return null

  return (
    <View style={[styles.statusBar, isDark && styles.statusBarDark]}>
      <ActivityIndicator size="small" color="#8b5cf6" />
      <Text style={[styles.statusText, isDark && styles.textDark]}>
        {status.type === "retry" ? `Retrying (attempt ${status.attempt})...` : text || "Working..."}
      </Text>
    </View>
  )
}

// --- Main screen ---
function getShortDir(dir?: string): string | null {
  if (!dir) return null
  const parts = dir.split("/").filter(Boolean)
  return parts[parts.length - 1] || null
}

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"

  const flatListRef = useRef<FlatList>(null)
  const [input, setInput] = useState("")

  const { currentSession, messages, parts, isLoading, isSending, selectSession, sendMessage, abortSession } =
    useSessions()

  const { authenticateForMessage } = useAuth()
  const { client } = useConnections()

  // Permission & question state for this session
  const sessionID = currentSession?.id
  const permissions = useEvents((s) => (sessionID ? s.permissions[sessionID] : undefined)) || []
  const questions = useEvents((s) => (sessionID ? s.questions[sessionID] : undefined)) || []

  const shortDir = getShortDir(currentSession?.directory)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const initialScrollUntil = useRef(0)
  const prevMessageCount = useRef(0)
  const userHasScrolled = useRef(false)

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

  useEffect(() => {
    const count = messages?.length || 0
    if (count > prevMessageCount.current && prevMessageCount.current > 0 && !isLoading) {
      scrollToBottom(true)
    }
    prevMessageCount.current = count
  }, [messages?.length])

  const handleSend = async () => {
    if (!input.trim()) return
    const authenticated = await authenticateForMessage()
    if (!authenticated) return

    const text = input.trim()
    setInput("")

    // If busy, abort first then send (interrupt)
    if (isSending) {
      await abortSession()
      // Small delay to let abort propagate
      await new Promise((r) => setTimeout(r, 300))
    }

    await sendMessage(text)
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
      if (isSending) {
        scrollToBottom(true)
      }
    },
    [isSending, scrollToBottom],
  )

  const handlePermissionReply = async (requestID: string, reply: "once" | "always" | "reject") => {
    if (!client) return
    try {
      await client.permission.reply(requestID, reply)
    } catch (err) {
      console.error("Permission reply failed:", err)
    }
  }

  const handleQuestionReply = async (requestID: string, answers: string[][]) => {
    if (!client) return
    try {
      await client.question.reply(requestID, answers)
    } catch (err) {
      console.error("Question reply failed:", err)
    }
  }

  const handleQuestionReject = async (requestID: string) => {
    if (!client) return
    try {
      await client.question.reject(requestID)
    } catch (err) {
      console.error("Question reject failed:", err)
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: currentSession?.title || "Session",
          headerRight: () => (
            <View style={styles.headerRight}>
              {shortDir && (
                <View style={[styles.dirBadge, isDark && styles.dirBadgeDark]}>
                  <Ionicons name="folder-outline" size={14} color={isDark ? "#888888" : "#666666"} />
                  <Text style={[styles.dirText, isDark && styles.dirTextDark]}>{shortDir}</Text>
                </View>
              )}
            </View>
          ),
        }}
      />

      <KeyboardAvoidingView
        style={[styles.container, isDark && styles.containerDark]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={isDark ? "#ffffff" : "#0a0a0a"} />
          </View>
        ) : (
          <View style={styles.listContainer}>
            <FlatList
              ref={flatListRef}
              data={messageData}
              keyExtractor={(item) => item.message.id}
              renderItem={({ item }) => <MessageBubble message={item.message} parts={item.parts} isDark={isDark} />}
              contentContainerStyle={styles.messageList}
              onScroll={handleScroll}
              scrollEventThrottle={100}
              onContentSizeChange={handleContentSizeChange}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="chatbubble-outline" size={48} color={isDark ? "#444444" : "#cccccc"} />
                  <Text style={[styles.emptyText, isDark && styles.metaDark]}>Start a conversation</Text>
                </View>
              }
            />
            {showScrollButton && (
              <TouchableOpacity
                style={[styles.scrollButton, isDark && styles.scrollButtonDark]}
                onPress={() => scrollToBottom(true)}
              >
                <Ionicons name="chevron-down" size={24} color={isDark ? "#ffffff" : "#0a0a0a"} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Status indicator */}
        {currentSession && <StatusIndicator sessionID={currentSession.id} isDark={isDark} />}

        {/* Permission prompts */}
        {permissions.map((perm) => (
          <PermissionPrompt
            key={perm.id}
            permission={perm}
            isDark={isDark}
            onReply={(reply) => handlePermissionReply(perm.id, reply)}
          />
        ))}

        {/* Question prompts */}
        {questions.map((q) => (
          <QuestionPrompt
            key={q.id}
            request={q}
            isDark={isDark}
            onReply={(answers) => handleQuestionReply(q.id, answers)}
            onReject={() => handleQuestionReject(q.id)}
          />
        ))}

        {/* Input area */}
        <View style={[styles.inputContainer, isDark && styles.inputContainerDark]}>
          <TextInput
            style={[styles.input, isDark && styles.inputDark]}
            placeholder={isSending ? "Type to interrupt..." : "Type a message..."}
            placeholderTextColor={isDark ? "#666666" : "#999999"}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={10000}
          />
          {isSending && !input.trim() ? (
            <TouchableOpacity style={styles.stopButton} onPress={abortSession}>
              <Ionicons name="stop" size={20} color="#ffffff" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.sendButton, !input.trim() && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!input.trim()}
            >
              <Ionicons name={isSending ? "arrow-up" : "send"} size={20} color="#ffffff" />
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  containerDark: { backgroundColor: "#0a0a0a" },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  listContainer: { flex: 1, position: "relative" },

  // Scroll button
  scrollButton: {
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
  scrollButtonDark: { backgroundColor: "#2a2a2a" },

  // Messages
  messageList: { padding: 16, paddingBottom: 8 },
  messageBubble: { marginBottom: 16, padding: 12, borderRadius: 12, maxWidth: "100%" },
  userBubble: { backgroundColor: "#f5f5f5", marginLeft: 32 },
  userBubbleDark: { backgroundColor: "#1a1a1a" },
  assistantBubble: { backgroundColor: "#f0f0ff" },
  assistantBubbleDark: { backgroundColor: "#1a1a2e" },
  messageHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  messageRole: { fontSize: 13, fontWeight: "600", color: "#666666" },
  userRole: { color: "#0a0a0a" },
  textDark: { color: "#ffffff" },
  modelTag: {
    fontSize: 11,
    color: "#999999",
    backgroundColor: "#e5e5e5",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  messageText: { fontSize: 15, lineHeight: 22, color: "#0a0a0a" },
  markdownContainer: { marginHorizontal: -4 },
  tokenInfo: { fontSize: 11, color: "#999999", marginTop: 8 },
  metaDark: { color: "#666666" },

  // Reasoning
  reasoningBlock: {
    backgroundColor: "#fffbeb",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#fef3c7",
  },
  reasoningBlockDark: { backgroundColor: "#1a1a0a", borderColor: "#333300" },
  reasoningHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  reasoningLabel: { fontSize: 12, fontWeight: "600", color: "#92400e", flex: 1 },
  reasoningText: { fontSize: 13, lineHeight: 20, color: "#78350f", marginTop: 8 },

  // Tool calls
  toolCall: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#ffffff",
    padding: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  toolCallDark: { backgroundColor: "#2a2a2a" },
  toolHeader: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  toolName: { fontSize: 13, fontWeight: "500", color: "#0a0a0a", flex: 1 },

  // Status bar
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#f5f3ff",
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
  },
  statusBarDark: { backgroundColor: "#1a1a2e", borderTopColor: "#2a2a2a" },
  statusText: { fontSize: 13, color: "#6d28d9", fontWeight: "500" },

  // Permissions
  permissionCard: {
    margin: 12,
    padding: 16,
    backgroundColor: "#fffbeb",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#fef3c7",
  },
  permissionCardDark: { backgroundColor: "#1a1800", borderColor: "#333300" },
  permissionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  permissionTitle: { fontSize: 15, fontWeight: "600", color: "#92400e" },
  permissionType: { fontSize: 13, color: "#78350f", marginBottom: 12 },
  permissionActions: { flexDirection: "row", gap: 8 },
  permissionBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  permissionDeny: { backgroundColor: "#fef2f2" },
  permissionDenyText: { color: "#dc2626", fontWeight: "600", fontSize: 14 },
  permissionAlways: { backgroundColor: "#f5f5f5" },
  permissionAlwaysDark: { backgroundColor: "#2a2a2a" },
  permissionAlwaysText: { color: "#0a0a0a", fontWeight: "600", fontSize: 14 },
  permissionAllow: { backgroundColor: "#0a0a0a" },
  permissionAllowDark: { backgroundColor: "#ffffff" },
  permissionAllowText: { color: "#ffffff", fontWeight: "600", fontSize: 14 },
  permissionAllowTextDark: { color: "#0a0a0a" },

  // Questions
  questionCard: {
    margin: 12,
    padding: 16,
    backgroundColor: "#f5f3ff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ede9fe",
  },
  questionCardDark: { backgroundColor: "#1a1a2e", borderColor: "#2a2a3e" },
  questionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  questionTitle: { fontSize: 15, fontWeight: "600", color: "#6d28d9" },
  questionText: { fontSize: 14, lineHeight: 20, color: "#0a0a0a", marginBottom: 12 },
  questionOptions: { gap: 8 },
  questionOption: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  questionOptionDark: { backgroundColor: "#2a2a2a", borderColor: "#3a3a3a" },
  questionOptionSelected: { borderColor: "#8b5cf6", backgroundColor: "#f5f3ff" },
  questionOptionSelectedDark: { borderColor: "#8b5cf6", backgroundColor: "#2a1a3e" },
  questionOptionLabel: { fontSize: 14, fontWeight: "600", color: "#0a0a0a" },
  questionOptionLabelSelected: { color: "#6d28d9" },
  questionOptionDesc: { fontSize: 12, color: "#666666", marginTop: 2 },
  questionCustomRow: { flexDirection: "row", gap: 8 },
  questionCustomInput: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    color: "#0a0a0a",
  },
  questionCustomInputDark: { backgroundColor: "#2a2a2a", borderColor: "#3a3a3a", color: "#ffffff" },
  questionCustomSubmit: { justifyContent: "center", alignItems: "center", padding: 8 },
  questionFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 },
  questionDismiss: { fontSize: 14, color: "#999999" },
  questionSubmitBtn: { backgroundColor: "#8b5cf6", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  questionSubmitBtnDark: { backgroundColor: "#7c3aed" },
  questionSubmitText: { color: "#ffffff", fontWeight: "600", fontSize: 14 },
  questionSubmitTextDark: { color: "#ffffff" },

  // Empty
  emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: 64 },
  emptyText: { fontSize: 16, color: "#999999", marginTop: 12 },

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
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#0a0a0a",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  sendButtonDisabled: { backgroundColor: "#cccccc" },
  stopButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  abortButton: { padding: 8 },
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
