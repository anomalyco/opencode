import { For, Show, createEffect, createMemo, createSignal, onMount } from "solid-js"
import { RGBA, TextAttributes } from "@opentui/core"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { Locale } from "@/util/locale"
import { useTerminalDimensions } from "@opentui/solid"
import type { AssistantMessage, ReasoningPart, TextPart, ToolPart } from "@opencode-ai/sdk"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
})

const defaultContextStats = {
  tokens: 0,
  tokenLimit: 0,
  tokensFormatted: "0",
  tokenLimitFormatted: "0",
  percentage: 0,
  systemTokens: 0,
  assistantTokens: 0,
  userTokens: 0,
  toolTokens: 0,
}

type TimelineItem = {
  id: string
  type: "system" | "user" | "assistant" | "tool"
  timestamp: number
  title: string
  summary: string
  details?: string[]
  tokens?: string
  cost?: string
  meta?: string
}

const TYPE_LABEL: Record<TimelineItem["type"], string> = {
  system: "System Context",
  user: "User",
  assistant: "Assistant",
  tool: "Tool",
}

const TYPE_SYMBOL: Record<TimelineItem["type"], string> = {
  system: "◆",
  user: "●",
  assistant: "●",
  tool: "▲",
}

export function DialogContextTimeline(props: { sessionID: string }) {
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const [maxHeight, setMaxHeight] = createSignal(Math.max(24, Math.floor(dimensions().height * 0.75)))
  const timelineListHeight = createMemo(() => {
    const height = maxHeight()
    if (!height) return undefined
    return Math.max(10, height - 12)
  })

  createEffect(() => {
    const dims = dimensions()
    const height = Math.max(24, Math.floor(dims.height * 0.75))
    setMaxHeight(height)
    dialog.setFrame({
      height,
      top: Math.max(1, Math.floor((dims.height - height) / 2)),
    })
  })

  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const contextStats = createMemo(() => {
    const lastAssistant = messages().findLast((x): x is AssistantMessage => x.role === "assistant" && !!x.tokens)
    if (!lastAssistant || !lastAssistant.tokens) return defaultContextStats

    const systemTokens = lastAssistant.tokens.cache?.write || 0
    const assistantTokens = (lastAssistant.tokens.output || 0) + (lastAssistant.tokens.reasoning || 0)
    const userTokens = Math.max(0, (lastAssistant.tokens.input || 0) - (lastAssistant.tokens.cache?.read || 0))
    const toolTokens = lastAssistant.tokens.cache?.read || 0
    const total = systemTokens + assistantTokens + userTokens + toolTokens
    const model = sync.data.provider.find((p) => p.id === lastAssistant.providerID)?.models[lastAssistant.modelID]
    const tokenLimit = model?.limit.context || 0

    return {
      tokens: total,
      tokenLimit,
      tokensFormatted: total.toLocaleString(),
      tokenLimitFormatted: tokenLimit ? tokenLimit.toLocaleString() : "—",
      percentage: tokenLimit ? Math.round((total / tokenLimit) * 100) : 0,
      systemTokens,
      assistantTokens,
      userTokens,
      toolTokens,
    }
  })

  const timeline = createMemo(() => {
    const items: TimelineItem[] = []
    const list = messages()
    if (list.length === 0) return items

    const stats = contextStats()
    if (stats.tokens > 0) {
      items.push({
        id: "context-root",
        type: "system",
        timestamp: (list[0]?.time.created ?? Date.now()) - 1,
        title: TYPE_LABEL.system,
        summary: `${stats.systemTokens.toLocaleString()} system tokens establish the initial instructions and cached context`,
        details: [
          `Assistant: ${stats.assistantTokens.toLocaleString()} tokens`,
          `User: ${stats.userTokens.toLocaleString()} tokens`,
          `Tool/cache: ${stats.toolTokens.toLocaleString()} tokens`,
        ],
        tokens: `${stats.tokensFormatted} / ${stats.tokenLimitFormatted}`,
        meta: `${stats.percentage}% used`,
      })
    }

    for (const message of list) {
      const parts = sync.data.part[message.id] ?? []
      if (message.role === "user") {
        const textParts = parts.filter((part): part is TextPart => part.type === "text" && !part.synthetic)
        const primary = textParts[0]?.text ?? "User input without additional text"
        const details = textParts.slice(1).map((part) => sanitizeText(part.text, 140))
        items.push({
          id: message.id,
          type: "user",
          timestamp: message.time.created,
          title: TYPE_LABEL.user,
          summary: sanitizeText(primary),
          details: details.length ? details : undefined,
        })
        continue
      }

      const assistantText = parts.filter((part): part is TextPart => part.type === "text" && !part.synthetic)
      const reasoning = parts.filter((part): part is ReasoningPart => part.type === "reasoning")
      const tools = parts.filter((part): part is ToolPart => part.type === "tool")
      const summarySource = assistantText[0]?.text || reasoning[0]?.text || "Assistant activity"
      const assistantDetails: string[] = []
      for (const extra of assistantText.slice(1)) {
        assistantDetails.push(`Follow-up: ${sanitizeText(extra.text, 140)}`)
      }
      for (const thought of reasoning) {
        assistantDetails.push(`Thought: ${sanitizeText(thought.text, 140)}`)
      }
      if ((message as AssistantMessage).error) {
        const err = (message as AssistantMessage).error!
        assistantDetails.push(
          `Error: ${"data" in err && err.data && typeof err.data === "object" && "message" in err.data ? (err.data as any).message : err.name}`,
        )
      }

      items.push({
        id: message.id,
        type: "assistant",
        timestamp: message.time.created,
        title: TYPE_LABEL.assistant,
        summary: sanitizeText(summarySource),
        details: assistantDetails.length ? assistantDetails : undefined,
        tokens: formatTokenSummary((message as AssistantMessage).tokens),
        cost: formatCost((message as AssistantMessage).cost),
        meta: (message as AssistantMessage).modelID,
      })

      tools.forEach((tool, idx) => {
        const status = Locale.titlecase(tool.state.status)
        const summary = buildToolSummary(tool)
        const toolDetails = buildToolDetails(tool)
        const duration = getToolDuration(tool)
        const metaParts = [status]
        if (duration) metaParts.push(duration)
        const toolTime = getToolTime(tool)
        items.push({
          id: tool.id,
          type: "tool",
          timestamp: toolTime?.start ?? message.time.created + idx,
          title: `${TYPE_LABEL.tool}: ${tool.tool}`,
          summary,
          details: toolDetails.length ? toolDetails : undefined,
          meta: metaParts.join(" · "),
        })
      })
    }

    return items.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
  })

  const typeColor = (type: TimelineItem["type"]) => {
    switch (type) {
      case "user":
        return theme.secondary
      case "assistant":
        return theme.accent
      case "tool":
        return theme.warning
      case "system":
      default:
        return theme.textMuted
    }
  }

  const typeBackground = (type: TimelineItem["type"]) => {
    switch (type) {
      case "user":
        return RGBA.fromInts(theme.secondary.r, theme.secondary.g, theme.secondary.b, 60)
      case "assistant":
        return RGBA.fromInts(theme.accent.r, theme.accent.g, theme.accent.b, 60)
      case "tool":
        return RGBA.fromInts(theme.warning.r, theme.warning.g, theme.warning.b, 60)
      case "system":
      default:
        return RGBA.fromInts(theme.textMuted.r, theme.textMuted.g, theme.textMuted.b, 40)
    }
  }

  const [expandedItem, setExpandedItem] = createSignal<string | null>(null)
  const toggleItem = (id: string) => {
    setExpandedItem((prev) => (prev === id ? null : id))
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between" alignItems="center">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Context Timeline
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <text fg={theme.textMuted} wrapMode="word">
        Detailed breakdown of system instructions, user prompts, assistant responses, and tool calls in chronological
        order.
      </text>

      <Show when={contextStats().tokens > 0}>
        <box flexDirection="row" gap={1} paddingTop={1}>
          <box
            flexGrow={1}
            padding={1}
            borderStyle="rounded"
            borderColor={theme.border}
            backgroundColor={theme.backgroundPanel}
          >
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Tokens
            </text>
            <text fg={theme.text}>{contextStats().tokensFormatted}</text>
            <text fg={theme.textMuted}>
              {contextStats().percentage}% of {contextStats().tokenLimitFormatted}
            </text>
          </box>
          <box
            flexGrow={1}
            padding={1}
            borderStyle="rounded"
            borderColor={theme.border}
            backgroundColor={theme.backgroundPanel}
          >
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Breakdown
            </text>
            <text fg={theme.textMuted}>
              System {contextStats().systemTokens.toLocaleString()} • Assistant{" "}
              {contextStats().assistantTokens.toLocaleString()} • User {contextStats().userTokens.toLocaleString()} •
              Tool {contextStats().toolTokens.toLocaleString()}
            </text>
          </box>
        </box>
      </Show>

      <Show when={timeline().length > 0} fallback={<text fg={theme.textMuted}>No timeline entries yet.</text>}>
        <scrollbox
          flexDirection="column"
          gap={1}
          paddingTop={1}
          maxHeight={timelineListHeight()}
          scrollbarOptions={{ visible: false }}
          renderBefore={function () {
            const el = this as any
            el.enableMouse?.()
          }}
        >
          <For each={timeline()}>
            {(item) => {
              const isExpanded = createMemo(() => expandedItem() === item.id)
              const preview = createMemo(() => {
                const details = item.details ?? []
                if (!details.length || isExpanded()) return null
                if (details.length === 1) return details[0]
                return `${details[0]} (+${details.length - 1} more)`
              })
              return (
                <box
                  flexDirection="column"
                  gap={1}
                  padding={1}
                  minWidth={50}
                  flexBasis={0}
                  flexGrow={1}
                  borderStyle="rounded"
                  borderColor={typeColor(item.type)}
                  backgroundColor={typeBackground(item.type)}
                  onMouseUp={() => toggleItem(item.id)}
                >
                  <box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
                    <text fg={typeColor(item.type)} attributes={TextAttributes.BOLD}>
                      {isExpanded() ? "▼" : "▶"} {TYPE_SYMBOL[item.type]} {item.title}
                    </text>
                    <text fg={theme.textMuted}>{Locale.time(item.timestamp)}</text>
                  </box>
                  <text fg={theme.text} wrapMode="word">
                    {item.summary}
                    {item.meta ? ` · ${item.meta}` : ""}
                  </text>
                  <Show when={item.tokens || item.cost}>
                    <box flexDirection="column" gap={0}>
                      <Show when={item.tokens}>
                        <text fg={theme.textMuted}>{item.tokens}</text>
                      </Show>
                      <Show when={item.cost}>
                        <text fg={theme.textMuted}>{item.cost}</text>
                      </Show>
                    </box>
                  </Show>
                  <Show when={preview()}>
                    {(detail) => (
                      <text fg={theme.textMuted} wrapMode="word">
                        • {detail()}
                      </text>
                    )}
                  </Show>
                  <Show when={isExpanded()}>
                    <box flexDirection="column" gap={0}>
                      <For each={item.details ?? []}>
                        {(detail) => (
                          <text fg={theme.textMuted} wrapMode="word">
                            • {detail}
                          </text>
                        )}
                      </For>
                    </box>
                  </Show>
                </box>
              )
            }}
          </For>
        </scrollbox>
      </Show>
    </box>
  )
}

function sanitizeText(input: string, max = 200) {
  if (!input) return "(no content)"
  const cleaned = Locale.stripMarkdown(input).replace(/\s+/g, " ").trim()
  if (!cleaned) return "(no content)"
  return Locale.truncate(cleaned, max)
}

function formatTokenSummary(tokens?: AssistantMessage["tokens"]) {
  if (!tokens) return undefined
  const segments = [`in ${Locale.number(tokens.input)}`, `out ${Locale.number(tokens.output)}`]
  if (tokens.reasoning) segments.push(`reasoning ${Locale.number(tokens.reasoning)}`)
  if (tokens.cache?.read) segments.push(`cache read ${Locale.number(tokens.cache.read)}`)
  if (tokens.cache?.write) segments.push(`cache write ${Locale.number(tokens.cache.write)}`)
  return `Tokens ${segments.join(" • ")}`
}

function formatCost(cost?: number) {
  if (!cost || cost <= 0) return undefined
  return `Cost ${money.format(cost)} (est.)`
}

function getToolTime(tool: ToolPart): { start: number; end?: number } | undefined {
  const state = tool.state as Record<string, unknown>
  if (state && "time" in state && state.time) {
    return state.time as { start: number; end?: number }
  }
  return undefined
}

function getToolMetadata(tool: ToolPart): Record<string, unknown> | undefined {
  const state = tool.state as Record<string, unknown>
  if (state && "metadata" in state) {
    return state.metadata as Record<string, unknown> | undefined
  }
  return undefined
}

function buildToolSummary(tool: ToolPart) {
  switch (tool.state.status) {
    case "completed":
      return sanitizeText(tool.state.title || tool.state.output || "Tool completed")
    case "running":
      return sanitizeText(tool.state.title || "Tool running")
    case "error":
      return sanitizeText(tool.state.error || "Tool error")
    case "pending":
      return sanitizeText("Awaiting tool execution")
    default:
      return sanitizeText("Tool activity")
  }
}

function buildToolDetails(tool: ToolPart) {
  const details: string[] = []
  if (tool.state.status === "completed" && tool.state.attachments?.length) {
    details.push(`Attachments: ${tool.state.attachments.length}`)
  }
  if (tool.state.status === "completed" && tool.state.output) {
    details.push(`Output: ${sanitizeText(tool.state.output, 120)}`)
  }
  if (tool.state.status === "error" && tool.state.error) {
    details.push(`Error: ${sanitizeText(tool.state.error, 160)}`)
  }
  details.push(...summarizeObject(getToolMetadata(tool), "Meta"))
  details.push(...summarizeObject(tool.state.input, "Input"))
  return details.slice(0, 5)
}

function summarizeObject(value: Record<string, unknown> | undefined, label: string) {
  if (!value) return []
  return Object.entries(value)
    .filter(([, v]) => v !== undefined && v !== null)
    .slice(0, 2)
    .map(([key, v]) => `${label} ${Locale.titlecase(key)}: ${truncateValue(v)}`)
}

function truncateValue(value: unknown) {
  if (typeof value === "string") return sanitizeText(value, 80)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return Locale.truncate(JSON.stringify(value), 80)
  } catch {
    return "(complex value)"
  }
}

function getToolDuration(tool: ToolPart) {
  const time = getToolTime(tool)
  if (!time || typeof time.start !== "number" || typeof time.end !== "number") return undefined
  const duration = time.end - time.start
  if (duration < 1000) return `${duration}ms`
  if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`
  return `${(duration / 60000).toFixed(1)}m`
}
