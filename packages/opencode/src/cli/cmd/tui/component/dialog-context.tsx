import { createMemo, For } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"

interface ContextItem {
  type: "system" | "instruction" | "message"
  name: string
  tokens: number
}

export function DialogContext(props: { sessionID: string }) {
  const { theme } = useTheme()
  const sync = useSync()
  const local = useLocal()

  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const contextBreakdown = createMemo(() => {
    const breakdown: ContextItem[] = []

    // Get last assistant message for actual token info
    const lastAssistant = messages().findLast(
      (x) => x.role === "assistant" && (x as AssistantMessage).tokens?.output > 0
    ) as AssistantMessage | undefined

    const model = local.model.current()

    // System prompt (varies by provider)
    if (model) {
      breakdown.push({
        type: "system",
        name: `System prompt (${model.providerID})`,
        tokens: lastAssistant?.tokens?.cache?.write ?? 8000,
      })
    }

    // Environment & file tree
    breakdown.push({
      type: "system",
      name: "Environment & file tree",
      tokens: 2000,
    })

    // Instructions from config
    breakdown.push({
      type: "instruction",
      name: "Custom instructions",
      tokens: 4000,
    })

    // Conversation history
    let conversationTokens = 0
    for (const msg of messages()) {
      if (msg.role === "assistant") {
        const assistant = msg as AssistantMessage
        conversationTokens += assistant.tokens?.input ?? 0
      }
    }

    if (conversationTokens > 0) {
      breakdown.push({
        type: "message",
        name: `Messages (${messages().length} total)`,
        tokens: conversationTokens,
      })
    }

    return breakdown
  })

  const totalTokens = createMemo(() => {
    return contextBreakdown().reduce((sum, item) => sum + item.tokens, 0)
  })

  const context = createMemo(() => {
    const last = messages().findLast(
      (x) => x.role === "assistant" && (x as AssistantMessage).tokens?.output > 0
    ) as AssistantMessage | undefined
    if (!last) return undefined
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: totalTokens(),
      percentage: model?.limit.context ? Math.round((totalTokens() / model.limit.context) * 100) : null,
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Context Preview
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <box>
        <text fg={theme.text}>
          <b>Total Context</b>
        </text>
        <text fg={theme.textMuted}>
          {context()?.tokens.toLocaleString() ?? "0"} tokens
          {context()?.percentage ? ` (${context()?.percentage}% of limit)` : ""}
        </text>
      </box>

      <box>
        <text fg={theme.text}>
          <b>Breakdown</b>
        </text>
        <For each={contextBreakdown()}>
          {(item) => (
            <box flexDirection="row" justifyContent="space-between">
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  fg={
                    item.type === "system"
                      ? theme.success
                      : item.type === "instruction"
                      ? theme.warning
                      : theme.primary
                  }
                >
                  •
                </text>
                <text fg={theme.text}>{item.name}</text>
              </box>
              <text fg={theme.textMuted}>{item.tokens.toLocaleString()}</text>
            </box>
          )}
        </For>
      </box>

      <box paddingTop={1}>
        <text fg={theme.textMuted}>
          This is an estimate of the context sent to the model. Actual token count may vary based on tokenization.
        </text>
      </box>
    </box>
  )
}
