import { createMemo, createSignal, For } from "solid-js"
import { useTheme } from "../context/theme"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"

interface ContextItem {
  type: "system" | "instruction" | "file" | "message"
  name: string
  tokens: number
  content?: string
  enabled: boolean
}

export function DialogContext(props: { sessionID: string }) {
  const { theme } = useTheme()
  const sync = useSync()
  const local = useLocal()

  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  // Calculate context breakdown
  const contextItems = createMemo((): ContextItem[] => {
    const items: ContextItem[] = []

    // Get last assistant message for token info
    const lastAssistant = messages().findLast(
      (x) => x.role === "assistant" && (x as AssistantMessage).tokens?.output > 0
    ) as AssistantMessage | undefined

    // System prompt estimate (varies by provider)
    const model = local.model.current()
    if (model) {
      items.push({
        type: "system",
        name: `System Prompt (${model.providerID})`,
        tokens: 8000, // Approximate
        enabled: true,
      })
    }

    // Environment context
    items.push({
      type: "system",
      name: "Environment & File Tree",
      tokens: 2000, // Approximate
      enabled: true,
    })

    // Instructions files
    const instructionFiles = [
      "~/context/PROMPT_TEMPLATE.md",
      "~/context/README.md",
      "AGENTS.md",
      "CLAUDE.md",
    ]
    for (const file of instructionFiles) {
      items.push({
        type: "instruction",
        name: file,
        tokens: 1500, // Approximate per file
        enabled: true,
      })
    }

    // Session messages
    let messageTokens = 0
    for (const msg of messages()) {
      if (msg.role === "assistant") {
        const assistant = msg as AssistantMessage
        messageTokens += assistant.tokens?.input ?? 0
        messageTokens += assistant.tokens?.output ?? 0
      }
    }
    if (messageTokens > 0) {
      items.push({
        type: "message",
        name: `Conversation History (${messages().length} messages)`,
        tokens: messageTokens,
        enabled: true,
      })
    }

    return items
  })

  const totalTokens = createMemo(() => {
    return contextItems().reduce((sum, item) => sum + (item.enabled ? item.tokens : 0), 0)
  })

  const [filter, setFilter] = createSignal("")

  const filteredItems = createMemo(() => {
    const f = filter().toLowerCase()
    if (!f) return contextItems()
    return contextItems().filter((item) => item.name.toLowerCase().includes(f))
  })

  return (
    <box
      flexDirection="column"
      borderStyle="rounded"
      borderColor={theme.border}
      backgroundColor={theme.backgroundPanel}
      padding={1}
      gap={1}
      width="80%"
      height="70%"
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>
          <b>Context Preview</b>
        </text>
        <text fg={theme.textMuted}>
          Total: {totalTokens().toLocaleString()} tokens
        </text>
      </box>

      <box flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>Filter:</text>
        <text fg={theme.text}>{filter() || "(type to filter)"}</text>
      </box>

      <box height={1} />

      <scrollbox flexGrow={1}>
        <box flexDirection="column" gap={1}>
          <For each={filteredItems()}>
            {(item) => (
              <box
                flexDirection="row"
                justifyContent="space-between"
                paddingLeft={1}
                paddingRight={1}
              >
                <box flexDirection="row" gap={1}>
                  <text
                    fg={
                      item.type === "system"
                        ? theme.primary
                        : item.type === "instruction"
                        ? theme.warning
                        : item.type === "file"
                        ? theme.success
                        : theme.textMuted
                    }
                  >
                    {item.type === "system"
                      ? "[SYS]"
                      : item.type === "instruction"
                      ? "[INS]"
                      : item.type === "file"
                      ? "[FILE]"
                      : "[MSG]"}
                  </text>
                  <text fg={item.enabled ? theme.text : theme.textMuted}>
                    {item.name}
                  </text>
                </box>
                <text fg={theme.textMuted}>
                  {item.tokens.toLocaleString()} tokens
                </text>
              </box>
            )}
          </For>
        </box>
      </scrollbox>

      <box height={1} />

      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>
          [SYS] System | [INS] Instructions | [FILE] Files | [MSG] Messages
        </text>
        <text fg={theme.textMuted}>Press Esc to close</text>
      </box>
    </box>
  )
}
