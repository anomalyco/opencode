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
  ScrollView,
} from "react-native"
import { useLocalSearchParams, Stack, useRouter } from "expo-router"
import { Ionicons } from "@expo/vector-icons"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import BottomSheet, { BottomSheetBackdrop, BottomSheetSectionList } from "@gorhom/bottom-sheet"
import { Markdown } from "../../src/components/markdown"
import { useSessions } from "../../src/stores/sessions"
import { useEvents } from "../../src/stores/events"
import { useConnections } from "../../src/stores/connections"
import { useAuth } from "../../src/stores/auth"
import { useCatalog } from "../../src/stores/catalog"
import type { Message, Part, Command } from "../../src/lib/sdk"

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

// --- Slash command definitions ---
interface SlashCommand {
  trigger: string
  title: string
  description?: string
  icon: string
  type: "builtin" | "custom"
}

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
        {message.model && <Text style={[styles.modelTag, isDark && styles.modelTagDark]}>{message.model.modelID}</Text>}
      </View>

      {/* Reasoning (collapsible) */}
      {reasoning && <ReasoningBlock text={reasoning} isDark={isDark} />}

      {/* Message text */}
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

// --- Slash autocomplete popover ---
function SlashPopover({
  query,
  commands,
  isDark,
  onSelect,
}: {
  query: string
  commands: SlashCommand[]
  isDark: boolean
  onSelect: (cmd: SlashCommand) => void
}) {
  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return commands.filter((c) => c.trigger.toLowerCase().startsWith(q) || c.title.toLowerCase().includes(q))
  }, [query, commands])

  if (filtered.length === 0) return null

  return (
    <View style={[styles.slashPopover, isDark && styles.slashPopoverDark]}>
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.slashScroll}>
        {filtered.map((cmd) => (
          <TouchableOpacity
            key={cmd.trigger}
            style={[styles.slashItem, isDark && styles.slashItemDark]}
            onPress={() => onSelect(cmd)}
          >
            <Ionicons
              name={cmd.icon as any}
              size={18}
              color={cmd.type === "custom" ? "#8b5cf6" : isDark ? "#888888" : "#666666"}
            />
            <View style={styles.slashTextCol}>
              <Text style={[styles.slashTrigger, isDark && styles.textDark]}>/{cmd.trigger}</Text>
              {cmd.description && (
                <Text style={[styles.slashDesc, isDark && styles.metaDark]} numberOfLines={1}>
                  {cmd.description}
                </Text>
              )}
            </View>
            {cmd.type === "custom" && (
              <View style={[styles.slashBadge, isDark && styles.slashBadgeDark]}>
                <Text style={styles.slashBadgeText}>cmd</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
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
  const router = useRouter()
  const colorScheme = useColorScheme()
  const isDark = colorScheme === "dark"
  const insets = useSafeAreaInsets()

  const flatListRef = useRef<FlatList>(null)
  const modelSheetRef = useRef<BottomSheet>(null)
  const [input, setInput] = useState("")
  const [modelSearch, setModelSearch] = useState("")

  const { currentSession, messages, parts, isLoading, isSending, selectSession, sendMessage, abortSession } =
    useSessions()

  const { authenticateForMessage } = useAuth()
  const { client } = useConnections()

  // Catalog: agents, commands, providers, current model/agent
  const catalog = useCatalog()
  const agents = Array.isArray(catalog.agents) ? catalog.agents : []
  const serverCommands = Array.isArray(catalog.commands) ? catalog.commands : []
  const providers = Array.isArray(catalog.providers) ? catalog.providers : []
  const agent = catalog.agent || ""
  const model = catalog.model
  const setModel = catalog.setModel
  const cycleAgent = catalog.cycleAgent

  // Permission & question state for this session
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

  // Build full command list: custom server commands first, then builtins
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

  // Model sheet sections with search filtering
  const modelSections = useMemo(() => {
    const list = Array.isArray(providers) ? providers : []
    const q = modelSearch.toLowerCase()
    return list
      .map((p) => {
        const models = (p.models || [])
          .filter(
            (m) =>
              !q ||
              m.id.toLowerCase().includes(q) ||
              m.name.toLowerCase().includes(q) ||
              p.name.toLowerCase().includes(q),
          )
          .map((m) => ({
            providerID: p.id,
            providerName: p.name || p.id,
            modelID: m.id,
            modelName: m.name || m.id,
          }))
        return { title: p.name || p.id, data: models }
      })
      .filter((s) => s.data.length > 0)
  }, [providers, modelSearch])

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

  // Sync model chip from the session's latest assistant message
  useEffect(() => {
    if (!messages || messages.length === 0) return
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === "assistant" && msg.providerID && msg.modelID) {
        setModel({ providerID: msg.providerID, modelID: msg.modelID })
        return
      }
      // Also check user messages that specified a model
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

  // Handle slash command selection
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
            // TODO: call client.session.summarize when available
            setInput("")
            return
          case "clear":
            setInput("")
            return
        }
      }
      // Custom server command: put the trigger in the input so user can add arguments and press send
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

    // If busy, abort first then send (interrupt)
    if (isSending) {
      await abortSession()
      await new Promise((r) => setTimeout(r, 300))
    }

    // Check for server slash commands
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

  const handleModelSelect = useCallback(
    (providerID: string, modelID: string) => {
      setModel({ providerID, modelID })
      setModelSearch("")
      modelSheetRef.current?.close()
    },
    [setModel],
  )

  // Current agent display info
  const currentAgent = agents.find((a) => a.name === agent)
  const agentColor = currentAgent?.color || "#8b5cf6"
  const modelLabel = model?.modelID ? model.modelID.split("/").pop() || model.modelID : "default"

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
                  <Text style={[styles.emptyHint, isDark && styles.metaDark]}>Type / for commands</Text>
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

        {/* Slash command popover */}
        {slashActive && (
          <SlashPopover query={slashQuery} commands={allCommands} isDark={isDark} onSelect={handleSlashSelect} />
        )}

        {/* Agent/model bar */}
        <View style={[styles.toolbar, isDark && styles.toolbarDark]}>
          <TouchableOpacity
            style={[styles.agentChip, { borderColor: agentColor }]}
            onPress={() => cycleAgent()}
            onLongPress={() => cycleAgent(-1)}
          >
            <View style={[styles.agentDot, { backgroundColor: agentColor }]} />
            <Text style={[styles.agentLabel, isDark && styles.textDark]}>{agent || "build"}</Text>
            <Ionicons name="swap-horizontal-outline" size={12} color={isDark ? "#888888" : "#666666"} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modelChip, isDark && styles.modelChipDark]}
            onPress={() => modelSheetRef.current?.expand()}
          >
            <Ionicons name="hardware-chip-outline" size={14} color={isDark ? "#888888" : "#666666"} />
            <Text style={[styles.modelLabel, isDark && styles.metaDark]} numberOfLines={1}>
              {modelLabel}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Input area */}
        <View
          style={[
            styles.inputContainer,
            isDark && styles.inputContainerDark,
            { paddingBottom: Math.max(12, insets.bottom) },
          ]}
        >
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

      {/* Model picker bottom sheet */}
      <BottomSheet
        ref={modelSheetRef}
        index={-1}
        snapPoints={["50%", "80%"]}
        enablePanDownToClose
        backgroundStyle={isDark ? styles.sheetDark : styles.sheet}
        handleIndicatorStyle={{ backgroundColor: isDark ? "#666666" : "#cccccc" }}
        backdropComponent={(props) => (
          <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
        )}
        onChange={(idx) => {
          if (idx === -1) setModelSearch("")
        }}
      >
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, isDark && styles.textDark]}>Select Model</Text>
          <TextInput
            style={[styles.sheetSearch, isDark && styles.sheetSearchDark]}
            placeholder="Search models..."
            placeholderTextColor={isDark ? "#666666" : "#999999"}
            value={modelSearch}
            onChangeText={setModelSearch}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>
        <BottomSheetSectionList
          sections={modelSections}
          keyExtractor={(item: { providerID: string; modelID: string }) => `${item.providerID}/${item.modelID}`}
          renderSectionHeader={({ section }: { section: { title: string } }) => (
            <View style={[styles.sectionHeader, isDark && styles.sectionHeaderDark]}>
              <Text style={[styles.sectionTitle, isDark && styles.metaDark]}>{section.title}</Text>
            </View>
          )}
          renderItem={({
            item,
          }: {
            item: { providerID: string; providerName: string; modelID: string; modelName: string }
          }) => {
            const selected = model?.providerID === item.providerID && model?.modelID === item.modelID
            return (
              <TouchableOpacity
                style={[styles.modelRow, isDark && styles.modelRowDark, selected && styles.modelRowSelected]}
                onPress={() => handleModelSelect(item.providerID, item.modelID)}
              >
                <View style={styles.modelRowText}>
                  <Text style={[styles.modelRowName, isDark && styles.textDark]} numberOfLines={1}>
                    {item.modelName || item.modelID}
                  </Text>
                  <Text style={[styles.modelRowProvider, isDark && styles.metaDark]}>
                    {item.providerName || item.providerID}
                  </Text>
                </View>
                {selected && <Ionicons name="checkmark-circle" size={20} color="#8b5cf6" />}
              </TouchableOpacity>
            )
          }}
          contentContainerStyle={styles.sheetContent}
          stickySectionHeadersEnabled
        />
      </BottomSheet>
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
  modelTagDark: { backgroundColor: "#2a2a2a", color: "#888888" },
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
  emptyHint: { fontSize: 13, color: "#bbbbbb", marginTop: 4 },

  // Slash popover
  slashPopover: {
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    maxHeight: 220,
  },
  slashPopoverDark: { backgroundColor: "#1a1a1a", borderTopColor: "#2a2a2a" },
  slashScroll: { paddingVertical: 4 },
  slashItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  slashItemDark: {},
  slashTextCol: { flex: 1 },
  slashTrigger: { fontSize: 14, fontWeight: "600", color: "#0a0a0a" },
  slashDesc: { fontSize: 12, color: "#999999", marginTop: 1 },
  slashBadge: {
    backgroundColor: "#f3e8ff",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  slashBadgeDark: { backgroundColor: "#2a1a3e" },
  slashBadgeText: { fontSize: 10, color: "#8b5cf6", fontWeight: "600" },

  // Toolbar (agent + model)
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

  // Bottom sheet
  sheet: { backgroundColor: "#ffffff" },
  sheetDark: { backgroundColor: "#1a1a1a" },
  sheetHeader: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: "#0a0a0a" },
  sheetSearch: {
    backgroundColor: "#f5f5f5",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: "#0a0a0a",
  },
  sheetSearchDark: { backgroundColor: "#2a2a2a", color: "#ffffff" },
  sheetContent: { paddingBottom: 40 },
  sectionHeader: {
    backgroundColor: "#f5f5f5",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sectionHeaderDark: { backgroundColor: "#111111" },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: "#999999", textTransform: "uppercase", letterSpacing: 0.5 },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  modelRowDark: { borderBottomColor: "#2a2a2a" },
  modelRowSelected: { backgroundColor: "#f5f3ff" },
  modelRowText: { flex: 1 },
  modelRowName: { fontSize: 15, fontWeight: "500", color: "#0a0a0a" },
  modelRowProvider: { fontSize: 12, color: "#999999", marginTop: 1 },
})
