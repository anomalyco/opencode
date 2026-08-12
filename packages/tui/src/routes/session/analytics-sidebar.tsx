import { createMemo } from "solid-js"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"

function padRight(str: string, len: number): string {
  return str.padEnd(len)
}

function padLeft(str: string, len: number): string {
  return str.padStart(len)
}

export function AnalyticsSidebar(props: { sessionID: string }) {
  const sync = useSync()
  const { theme } = useTheme()

  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const userMessages = createMemo(() => messages().filter((m) => m.role === "user"))
  const assistantMessages = createMemo(() => messages().filter((m) => m.role === "assistant") as AssistantMessage[])

  const totalTokens = createMemo(() =>
    assistantMessages().reduce(
      (acc, msg) => acc + msg.tokens.input + msg.tokens.output + msg.tokens.reasoning,
      0
    )
  )

  const inputTokens = createMemo(() =>
    assistantMessages().reduce((acc, msg) => acc + msg.tokens.input, 0)
  )

  const outputTokens = createMemo(() =>
    assistantMessages().reduce((acc, msg) => acc + msg.tokens.output, 0)
  )

  const totalCost = createMemo(() =>
    assistantMessages().reduce((acc, msg) => acc + msg.cost, 0)
  )

  const sessionDuration = createMemo(() => {
    const msgs = messages()
    if (msgs.length === 0) return 0
    const first = msgs[0]
    const last = msgs[msgs.length - 1]
    return (last.time.created - first.time.created) / 1000
  })

  const avgResponseTime = createMemo(() => {
    const completed = assistantMessages().filter((m) => m.time.completed && m.parentID)
    if (completed.length === 0) return 0
    const total = completed.reduce((acc, msg) => {
      const userMsg = messages().find((m) => m.id === msg.parentID)
      if (!userMsg) return acc
      return acc + (msg.time.completed! - userMsg.time.created)
    }, 0)
    return total / completed.length / 1000
  })

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return `${mins}m ${secs}s`
  }



  const LABEL_WIDTH = 12

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      width={24}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
      gap={0}
    >
      <text fg={theme.text} bold marginBottom={1}>
        {"Analytics"}
      </text>

      <text fg={theme.textMuted}>{"─ Messages ─"}</text>
      <text fg={theme.text}>{"  " + padRight("Total", LABEL_WIDTH) + messages().length}</text>
      <text fg={theme.text}>{"  " + padRight("User", LABEL_WIDTH) + userMessages().length}</text>
      <text fg={theme.text}>{"  " + padRight("Assistant", LABEL_WIDTH) + assistantMessages().length}</text>

      <text fg={theme.textMuted} marginTop={1}>{"─ Tokens ─"}</text>
      <text fg={theme.text}>{"  " + padRight("Input", LABEL_WIDTH) + inputTokens().toLocaleString()}</text>
      <text fg={theme.text}>{"  " + padRight("Output", LABEL_WIDTH) + outputTokens().toLocaleString()}</text>
      <text fg={theme.text}>{"  " + padRight("Total", LABEL_WIDTH) + totalTokens().toLocaleString()}</text>

      <text fg={theme.textMuted} marginTop={1}>{"─ Performance ─"}</text>
      <text fg={theme.text}>{"  " + padRight("Avg Response", LABEL_WIDTH) + formatDuration(avgResponseTime())}</text>
      <text fg={theme.text}>{"  " + padRight("Duration", LABEL_WIDTH) + formatDuration(sessionDuration())}</text>

      

      <box flexGrow={1} />
    </box>
  )
}
