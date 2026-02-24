import { createMemo, For, onMount, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "../../ui/dialog"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useSync } from "@tui/context/sync"
import type { AssistantMessage, TextPart, ToolPart, ReasoningPart, FilePart } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"

export function DialogContext(props: { sessionID: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sync = useSync()
  const dimensions = useTerminalDimensions()

  onMount(() => {
    dialog.setSize("large")
  })

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      dialog.clear()
    }
  })

  const session = createMemo(() => sync.session.get(props.sessionID))
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total,
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
      limit: model?.limit.context,
      input: last.tokens.input,
      output: last.tokens.output,
      reasoning: last.tokens.reasoning,
      cacheRead: last.tokens.cache.read,
      cacheWrite: last.tokens.cache.write,
      model: last.modelID,
      provider: last.providerID,
    }
  })

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  // Calculate context breakdown per message
  const contextBreakdown = createMemo(() => {
    const result: {
      role: string
      id: string
      preview: string
      tokens: number
      parts: { type: string; preview: string }[]
    }[] = []

    for (const message of messages()) {
      const parts = sync.data.part[message.id] ?? []
      const partBreakdown: { type: string; preview: string }[] = []

      for (const part of parts) {
        if (part.type === "text") {
          const textPart = part as TextPart
          if (!textPart.synthetic && !textPart.ignored) {
            partBreakdown.push({
              type: "text",
              preview: Locale.truncate(textPart.text.replace(/\n/g, " "), 50),
            })
          }
        } else if (part.type === "tool") {
          const toolPart = part as ToolPart
          partBreakdown.push({
            type: `tool:${toolPart.tool}`,
            preview: toolPart.state.status === "completed" ? toolPart.state.title : toolPart.state.status,
          })
        } else if (part.type === "reasoning") {
          const reasoningPart = part as ReasoningPart
          partBreakdown.push({
            type: "reasoning",
            preview: Locale.truncate(reasoningPart.text.replace(/\n/g, " "), 50),
          })
        } else if (part.type === "file") {
          const filePart = part as FilePart
          partBreakdown.push({
            type: "file",
            preview: filePart.filename ?? filePart.mime,
          })
        }
      }

      if (partBreakdown.length > 0) {
        const textPart = parts.find(
          (p) => p.type === "text" && !(p as TextPart).synthetic && !(p as TextPart).ignored,
        ) as TextPart | undefined

        result.push({
          role: message.role,
          id: message.id,
          preview: textPart ? Locale.truncate(textPart.text.replace(/\n/g, " "), 40) : `[${message.role}]`,
          tokens: message.role === "assistant" ? (message as AssistantMessage).tokens.input : 0,
          parts: partBreakdown,
        })
      }
    }

    return result
  })

  // Get last user message's system prompt info
  const systemInfo = createMemo(() => {
    const lastUser = messages().findLast((x) => x.role === "user")
    if (!lastUser || lastUser.role !== "user") return null
    return {
      agent: lastUser.agent,
      model: lastUser.model,
      system: lastUser.system ? Locale.truncate(lastUser.system, 200) : null,
      tools: lastUser.tools,
    }
  })

  const height = createMemo(() => Math.floor(dimensions().height / 2))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Session Context
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <Show when={session()}>
        <box paddingTop={1}>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.text }}>
              <b>{session()!.title}</b>
            </span>
          </text>
        </box>
      </Show>

      {/* Context Summary */}
      <Show when={context()}>
        <box
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={theme.backgroundElement}
        >
          <text fg={theme.text}>
            <b>Token Usage</b>
          </text>
          <box flexDirection="row" gap={2} paddingTop={1}>
            <box>
              <text fg={theme.textMuted}>Total</text>
              <text fg={theme.text}>{context()!.tokens.toLocaleString()}</text>
            </box>
            <box>
              <text fg={theme.textMuted}>Input</text>
              <text fg={theme.text}>{context()!.input.toLocaleString()}</text>
            </box>
            <box>
              <text fg={theme.textMuted}>Output</text>
              <text fg={theme.text}>{context()!.output.toLocaleString()}</text>
            </box>
            <Show when={context()!.reasoning > 0}>
              <box>
                <text fg={theme.textMuted}>Reasoning</text>
                <text fg={theme.text}>{context()!.reasoning.toLocaleString()}</text>
              </box>
            </Show>
          </box>
          <box flexDirection="row" gap={2} paddingTop={1}>
            <Show when={context()!.cacheRead > 0}>
              <box>
                <text fg={theme.textMuted}>Cache Read</text>
                <text fg={theme.success}>{context()!.cacheRead.toLocaleString()}</text>
              </box>
            </Show>
            <Show when={context()!.cacheWrite > 0}>
              <box>
                <text fg={theme.textMuted}>Cache Write</text>
                <text fg={theme.text}>{context()!.cacheWrite.toLocaleString()}</text>
              </box>
            </Show>
          </box>
          <box flexDirection="row" gap={2} paddingTop={1}>
            <Show when={context()!.limit}>
              <text fg={theme.textMuted}>
                {context()!.percentage}% of {context()!.limit!.toLocaleString()} limit
              </text>
            </Show>
            <text fg={theme.textMuted}>
              Model: {context()!.provider}/{context()!.model}
            </text>
          </box>
          <text fg={theme.textMuted} paddingTop={1}>
            Cost: {cost()}
          </text>
        </box>
      </Show>

      {/* System Info */}
      <Show when={systemInfo()}>
        <box paddingTop={1}>
          <text fg={theme.text}>
            <b>System Configuration</b>
          </text>
          <box paddingTop={1} gap={1}>
            <text fg={theme.textMuted}>
              Agent: <span style={{ fg: theme.text }}>{systemInfo()!.agent}</span>
            </text>
            <text fg={theme.textMuted}>
              Model:{" "}
              <span style={{ fg: theme.text }}>
                {systemInfo()!.model.providerID}/{systemInfo()!.model.modelID}
              </span>
            </text>
            <Show when={systemInfo()!.tools}>
              <text fg={theme.textMuted}>
                Tools enabled:{" "}
                <span style={{ fg: theme.text }}>
                  {Object.entries(systemInfo()!.tools ?? {})
                    .filter(([_, v]) => v)
                    .map(([k]) => k)
                    .join(", ") || "all"}
                </span>
              </text>
            </Show>
          </box>
        </box>
      </Show>

      {/* Message History */}
      <box paddingTop={1}>
        <text fg={theme.text}>
          <b>Message History</b> <span style={{ fg: theme.textMuted }}>({contextBreakdown().length} messages)</span>
        </text>
      </box>

      <scrollbox maxHeight={height()} scrollbarOptions={{ visible: true }} paddingRight={1}>
        <For each={contextBreakdown()}>
          {(item) => (
            <box paddingTop={1}>
              <box flexDirection="row" gap={1}>
                <text
                  fg={item.role === "user" ? theme.accent : theme.primary}
                  attributes={TextAttributes.BOLD}
                  flexShrink={0}
                >
                  {item.role === "user" ? "User" : "Assistant"}
                </text>
                <text fg={theme.textMuted} wrapMode="none" overflow="hidden">
                  {item.preview}
                </text>
              </box>
              <box paddingLeft={2}>
                <For each={item.parts.slice(0, 5)}>
                  {(part) => (
                    <text fg={theme.textMuted}>
                      <span style={{ fg: theme.text }}>• {part.type}</span> {part.preview}
                    </text>
                  )}
                </For>
                <Show when={item.parts.length > 5}>
                  <text fg={theme.textMuted}>... and {item.parts.length - 5} more parts</text>
                </Show>
              </box>
            </box>
          )}
        </For>
      </scrollbox>
    </box>
  )
}
