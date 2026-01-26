import { useState, useCallback } from "react"
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Platform } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import type { Part } from "../../lib/sdk"
import { DiffView } from "./DiffView"

const TOOL_ICONS: Record<string, string> = {
  read: "glasses-outline",
  list: "list-outline",
  glob: "search-outline",
  grep: "search-outline",
  webfetch: "globe-outline",
  edit: "code-slash-outline",
  write: "create-outline",
  apply_patch: "git-merge-outline",
  bash: "terminal-outline",
  task: "git-branch-outline",
  todowrite: "checkbox-outline",
  todoread: "checkbox-outline",
  question: "chatbubble-ellipses-outline",
  codesearch: "search-outline",
  websearch: "globe-outline",
}

const mono = Platform.OS === "ios" ? "Menlo" : "monospace"

function statusColor(status: string): string {
  if (status === "completed") return "#22c55e"
  if (status === "error") return "#ef4444"
  if (status === "running") return "#f59e0b"
  return "#888888"
}

// --- Tool-specific detail renderers ---

function BashDetail({ input, output, isDark }: { input: unknown; output: unknown; isDark: boolean }) {
  const cmd = typeof input === "object" && input !== null ? (input as Record<string, unknown>).command : undefined
  const out = typeof output === "string" ? output : undefined
  return (
    <View style={s.detailSection}>
      {typeof cmd === "string" && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable>
            <Text style={s.codePrompt}>$ </Text>
            {cmd}
          </Text>
        </View>
      )}
      {out !== undefined && out.length > 0 && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark, { marginTop: 6 }]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={80}>
            {out}
          </Text>
        </View>
      )}
    </View>
  )
}

function ReadDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const file = typeof input === "object" && input !== null ? (input as Record<string, unknown>).filePath : undefined
  const offset = typeof input === "object" && input !== null ? (input as Record<string, unknown>).offset : undefined
  const limit = typeof input === "object" && input !== null ? (input as Record<string, unknown>).limit : undefined
  const range = offset || limit ? ` (${offset || 0}..${limit || "end"})` : ""
  return (
    <View style={s.detailSection}>
      {typeof file === "string" && (
        <Text style={[s.detailFile, isDark && s.detailFileDark]} selectable numberOfLines={2}>
          {file}
          {range}
        </Text>
      )}
    </View>
  )
}

function WriteDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const file = typeof input === "object" && input !== null ? (input as Record<string, unknown>).filePath : undefined
  const content = typeof input === "object" && input !== null ? (input as Record<string, unknown>).content : undefined
  return (
    <View style={s.detailSection}>
      {typeof file === "string" && (
        <Text style={[s.detailFile, isDark && s.detailFileDark]} selectable numberOfLines={2}>
          {file}
        </Text>
      )}
      {typeof content === "string" && content.length > 0 && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark, { marginTop: 6 }]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={40}>
            {content}
          </Text>
        </View>
      )}
    </View>
  )
}

function EditDetail({ input, output, isDark }: { input: unknown; output: unknown; isDark: boolean }) {
  const file = typeof input === "object" && input !== null ? (input as Record<string, unknown>).filePath : undefined
  const old = typeof input === "object" && input !== null ? (input as Record<string, unknown>).oldString : undefined
  const replacement =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>).newString : undefined

  // If we have old/new strings, show as diff
  if (typeof old === "string" && typeof replacement === "string") {
    return (
      <View style={s.detailSection}>
        {typeof file === "string" && (
          <Text style={[s.detailFile, isDark && s.detailFileDark]} selectable numberOfLines={2}>
            {file}
          </Text>
        )}
        <DiffView before={old} after={replacement} isDark={isDark} />
      </View>
    )
  }

  // Fallback: show raw output
  const text = typeof output === "string" ? output : JSON.stringify(output, null, 2)
  return (
    <View style={s.detailSection}>
      {typeof file === "string" && (
        <Text style={[s.detailFile, isDark && s.detailFileDark]} selectable numberOfLines={2}>
          {file}
        </Text>
      )}
      {text && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark, { marginTop: 6 }]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={40}>
            {text}
          </Text>
        </View>
      )}
    </View>
  )
}

function PatchDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const patch = typeof input === "object" && input !== null ? (input as Record<string, unknown>).patch : undefined
  return (
    <View style={s.detailSection}>
      {typeof patch === "string" && patch.length > 0 && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={60}>
            {patch}
          </Text>
        </View>
      )}
    </View>
  )
}

function GlobGrepDetail({ input, output, isDark }: { input: unknown; output: unknown; isDark: boolean }) {
  const pattern = typeof input === "object" && input !== null ? (input as Record<string, unknown>).pattern : undefined
  const path = typeof input === "object" && input !== null ? (input as Record<string, unknown>).path : undefined
  const results = typeof output === "string" ? output : undefined
  return (
    <View style={s.detailSection}>
      {typeof pattern === "string" && (
        <Text style={[s.detailMeta, isDark && s.detailMetaDark]}>
          Pattern: {pattern}
          {typeof path === "string" ? ` in ${path}` : ""}
        </Text>
      )}
      {results && results.length > 0 && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark, { marginTop: 6 }]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={30}>
            {results}
          </Text>
        </View>
      )}
    </View>
  )
}

function WebfetchDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const url = typeof input === "object" && input !== null ? (input as Record<string, unknown>).url : undefined
  return (
    <View style={s.detailSection}>
      {typeof url === "string" && (
        <Text style={[s.detailFile, isDark && s.detailFileDark, { color: "#8b5cf6" }]} selectable numberOfLines={3}>
          {url}
        </Text>
      )}
    </View>
  )
}

function TaskDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const description =
    typeof input === "object" && input !== null ? (input as Record<string, unknown>).description : undefined
  const prompt = typeof input === "object" && input !== null ? (input as Record<string, unknown>).prompt : undefined
  return (
    <View style={s.detailSection}>
      {typeof description === "string" && <Text style={[s.detailMeta, isDark && s.detailMetaDark]}>{description}</Text>}
      {typeof prompt === "string" && prompt.length > 0 && (
        <View style={[s.codeBlock, isDark && s.codeBlockDark, { marginTop: 6 }]}>
          <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={20}>
            {prompt}
          </Text>
        </View>
      )}
    </View>
  )
}

function TodoDetail({ input, isDark }: { input: unknown; isDark: boolean }) {
  const todos = typeof input === "object" && input !== null ? (input as Record<string, unknown>).todos : undefined
  if (!Array.isArray(todos)) return null
  return (
    <View style={s.detailSection}>
      {todos.map((t, i) => {
        const item = t as Record<string, unknown>
        const done = item.status === "completed"
        return (
          <View key={String(item.id || i)} style={s.todoRow}>
            <Ionicons
              name={done ? "checkbox" : "square-outline"}
              size={16}
              color={done ? "#22c55e" : isDark ? "#666666" : "#999999"}
            />
            <Text style={[s.todoText, isDark && s.todoTextDark, done && s.todoDone]} numberOfLines={2}>
              {String(item.content || item.title || "")}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

function GenericDetail({ input, output, isDark }: { input: unknown; output: unknown; isDark: boolean }) {
  const text =
    typeof output === "string"
      ? output
      : output !== undefined && output !== null
        ? JSON.stringify(output, null, 2)
        : typeof input === "object" && input !== null
          ? JSON.stringify(input, null, 2)
          : undefined
  if (!text || text.length === 0) return null
  return (
    <View style={s.detailSection}>
      <View style={[s.codeBlock, isDark && s.codeBlockDark]}>
        <Text style={[s.codePre, isDark && s.codePteDark]} selectable numberOfLines={30}>
          {text}
        </Text>
      </View>
    </View>
  )
}

function ToolDetail({ tool, isDark }: { tool: Part; isDark: boolean }) {
  const name = tool.tool || ""
  const input = tool.state?.input
  const output = tool.state?.output

  switch (name) {
    case "bash":
      return <BashDetail input={input} output={output} isDark={isDark} />
    case "read":
      return <ReadDetail input={input} isDark={isDark} />
    case "write":
      return <WriteDetail input={input} isDark={isDark} />
    case "edit":
      return <EditDetail input={input} output={output} isDark={isDark} />
    case "apply_patch":
      return <PatchDetail input={input} isDark={isDark} />
    case "glob":
    case "grep":
    case "list":
    case "codesearch":
      return <GlobGrepDetail input={input} output={output} isDark={isDark} />
    case "webfetch":
    case "websearch":
      return <WebfetchDetail input={input} isDark={isDark} />
    case "task":
      return <TaskDetail input={input} isDark={isDark} />
    case "todowrite":
      return <TodoDetail input={input} isDark={isDark} />
    default:
      return <GenericDetail input={input} output={output} isDark={isDark} />
  }
}

// --- Error display ---
function ErrorBanner({ message, isDark }: { message: string; isDark: boolean }) {
  return (
    <View style={[s.errorBanner, isDark && s.errorBannerDark]}>
      <Ionicons name="alert-circle" size={14} color="#ef4444" />
      <Text style={s.errorText} numberOfLines={3} selectable>
        {message}
      </Text>
    </View>
  )
}

// --- Duration display ---
function duration(start?: number, end?: number): string | null {
  if (!start || !end) return null
  const ms = end - start
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// --- Main component ---
interface Props {
  tool: Part
  isDark: boolean
}

export function ToolCallCard({ tool, isDark }: Props) {
  const [expanded, setExpanded] = useState(false)
  const icon = (tool.tool && TOOL_ICONS[tool.tool]) || "extension-puzzle-outline"
  const status = tool.state?.status || "pending"
  const color = statusColor(status)
  const error = tool.state?.error?.message
  const elapsed = duration(tool.state?.time?.start, tool.state?.time?.end)
  const hasDetail = tool.state?.input !== undefined || tool.state?.output !== undefined || error

  const toggle = useCallback(() => {
    if (hasDetail) setExpanded((v) => !v)
  }, [hasDetail])

  return (
    <TouchableOpacity
      style={[
        s.card,
        isDark && s.cardDark,
        status === "error" && s.cardError,
        status === "error" && isDark && s.cardErrorDark,
      ]}
      onPress={toggle}
      activeOpacity={hasDetail ? 0.7 : 1}
    >
      {/* Header row */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Ionicons name={icon as any} size={16} color={color} />
          <Text style={[s.name, isDark && s.nameDark]} numberOfLines={1}>
            {tool.state?.title || tool.tool || "Tool"}
          </Text>
          {elapsed && <Text style={[s.elapsed, isDark && s.elapsedDark]}>{elapsed}</Text>}
        </View>
        <View style={s.headerRight}>
          {status === "running" && <ActivityIndicator size="small" color={color} />}
          {status === "completed" && <Ionicons name="checkmark-circle" size={16} color="#22c55e" />}
          {status === "error" && <Ionicons name="close-circle" size={16} color="#ef4444" />}
          {hasDetail && (
            <Ionicons
              name={expanded ? "chevron-up" : "chevron-down"}
              size={16}
              color={isDark ? "#666666" : "#999999"}
            />
          )}
        </View>
      </View>

      {/* Error banner */}
      {error && !expanded && <ErrorBanner message={error} isDark={isDark} />}

      {/* Expanded detail */}
      {expanded && (
        <ScrollView style={s.detailScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          {error && <ErrorBanner message={error} isDark={isDark} />}
          <ToolDetail tool={tool} isDark={isDark} />
        </ScrollView>
      )}
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  card: {
    backgroundColor: "#ffffff",
    padding: 10,
    borderRadius: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#f0f0f0",
  },
  cardDark: { backgroundColor: "#2a2a2a", borderColor: "#3a3a3a" },
  cardError: { borderColor: "#fecaca" },
  cardErrorDark: { borderColor: "#7f1d1d" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { fontSize: 13, fontWeight: "500", color: "#0a0a0a", flex: 1 },
  nameDark: { color: "#e5e5e5" },
  elapsed: { fontSize: 11, color: "#999999" },
  elapsedDark: { color: "#666666" },

  // Error
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginTop: 8,
    padding: 8,
    backgroundColor: "#fef2f2",
    borderRadius: 6,
  },
  errorBannerDark: { backgroundColor: "#1a0a0a" },
  errorText: { fontSize: 12, color: "#dc2626", flex: 1, lineHeight: 18 },

  // Detail
  detailScroll: { maxHeight: 300, marginTop: 8 },
  detailSection: { gap: 4 },
  detailFile: {
    fontSize: 12,
    fontFamily: mono,
    color: "#6d28d9",
    backgroundColor: "#f5f3ff",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    overflow: "hidden",
  },
  detailFileDark: { color: "#a78bfa", backgroundColor: "#1a1a2e" },
  detailMeta: { fontSize: 12, color: "#666666", lineHeight: 18 },
  detailMetaDark: { color: "#888888" },

  // Code block
  codeBlock: {
    backgroundColor: "#f8f8f8",
    borderRadius: 6,
    padding: 10,
  },
  codeBlockDark: { backgroundColor: "#1a1a1a" },
  codePre: {
    fontSize: 12,
    fontFamily: mono,
    color: "#0a0a0a",
    lineHeight: 18,
  },
  codePteDark: { color: "#e5e5e5" },
  codePrompt: { color: "#8b5cf6", fontWeight: "700" },

  // Todo
  todoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 3,
  },
  todoText: { fontSize: 13, color: "#0a0a0a", flex: 1, lineHeight: 20 },
  todoTextDark: { color: "#e5e5e5" },
  todoDone: { textDecorationLine: "line-through", color: "#999999" },
})
