import { createMemo, createSignal, Show, type Accessor } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useRoute } from "@tui/context/route"
import { useRenderer } from "@opentui/solid"
import { Locale } from "@/util/locale"
import { formatDuration } from "@/util/format"
import { useElapsed, useCountdown } from "./elapsed"
import { currentToolOf } from "./use-workflow"
import { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "@tui/ui/dialog-alert"
import type { ToolPart, AssistantMessage } from "@opencode-ai/sdk/v2"

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return `${n}`
}

export function WorkerRow(props: { sessionID: Accessor<string>; verbosity: Accessor<"minimal" | "normal" | "verbose"> }) {
  const sync = useSync()
  const { theme } = useTheme()
  const { navigate } = useRoute()
  const renderer = useRenderer()
  const dialog = useDialog()
  const [hover, setHover] = createSignal(false)

  const session = createMemo(() => sync.session.get(props.sessionID()))
  const status = createMemo(() => {
    const id = props.sessionID()
    const st = sync.data.session_status[id]?.type
    if (st && st !== "idle") return "running" as const
    const msgs = sync.data.message[id] ?? []
    const parts = msgs.flatMap((m) => (sync.data.part[m.id] ?? []).filter((p): p is ToolPart => p.type === "tool"))
    if (parts.some((p) => p.state.status === "error")) return "failed" as const
    const last = msgs.findLast((m): m is AssistantMessage => m.role === "assistant")
    if (last && last.tokens.output === 0) return "failed" as const
    return "completed" as const
  })
  const retryStatus = createMemo(() => {
    const st = sync.data.session_status[props.sessionID()]
    return st && st.type === "retry" ? st : undefined
  })
  const error = createMemo(() => {
    const id = props.sessionID()
    const msgs = sync.data.message[id] ?? []
    const parts = msgs.flatMap((m) => (sync.data.part[m.id] ?? []).filter((p): p is ToolPart => p.type === "tool"))
    const err = parts.findLast((p) => p.state.status === "error")
    return err && err.state.status === "error" ? err.state.error : undefined
  })
  const fullError = createMemo(() => error() ?? "failed")
  const started = createMemo(() => session()?.time.created ?? Date.now())
  const secs = useElapsed(started)
  const tool = createMemo(() => currentToolOf(sync, props.sessionID()))
  const toolLabel = createMemo(() => {
    const t = tool()
    if (!t) return ""
    return `${Locale.titlecase(t.tool)}${t.title ? " " + t.title : ""}`
  })
  const agentLabel = createMemo(() => {
    const s = session()
    if (!s) return "agent"
    const match = s.title.match(/@(\w+) subagent/)
    return match ? Locale.titlecase(match[1]) : Locale.titlecase(s.agent ?? "agent")
  })
  const prompt = createMemo(() => {
    const id = props.sessionID()
    const msgs = sync.data.message[id] ?? []
    const user = msgs.find((m) => m.role === "user")
    if (!user) return ""
    const parts = sync.data.part[user.id] ?? []
    return parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("")
  })
  const cost = createMemo(() => session()?.cost ?? 0)
  const tokens = createMemo(() => {
    const id = props.sessionID()
    const msgs = sync.data.message[id] ?? []
    const last = msgs.findLast((m): m is AssistantMessage => m.role === "assistant")
    return last ? last.tokens.output : 0
  })
  const retrySeconds = useCountdown(() => retryStatus()?.next)

  const onClick = () => {
    if (renderer.getSelection()?.getSelectedText()) return
    navigate({ type: "session", sessionID: props.sessionID() })
  }
  const onErrorClick = () => {
    if (renderer.getSelection()?.getSelectedText()) return
    void DialogAlert.show(dialog, "Worker Error", fullError())
  }

  const showPrompt = createMemo(() => props.verbosity() !== "minimal")
  const showChips = createMemo(() => props.verbosity() === "verbose")

  return (
    <box
      flexDirection="row"
      gap={1}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={onClick}
      backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
    >
      <Show
        when={status() === "running"}
        fallback={
          <Show when={status() === "failed"} fallback={<text fg={theme.success}>✓</text>}>
            <text fg={theme.error}>✕</text>
          </Show>
        }
      >
        <Show when={retryStatus()} fallback={<text fg={theme.textMuted}>⠂</text>}>
          <text fg={theme.warning}>↻</text>
        </Show>
      </Show>
      <text fg={theme.text}>{agentLabel()}</text>
      <Show when={retryStatus()}>
        <text fg={theme.warning} wrapMode="none">
          retrying in {formatDuration(retrySeconds()) || "0s"} attempt #{retryStatus()?.attempt}
        </text>
      </Show>
      <Show when={status() === "running" && !retryStatus()}>
        <text fg={theme.textMuted} wrapMode="none">
          ↳ {toolLabel()}
        </text>
      </Show>
      <Show when={showPrompt() && prompt()}>
        <text fg={theme.textMuted} wrapMode="none">
          "{Locale.truncate(prompt(), 40)}"
        </text>
      </Show>
      <Show when={status() === "failed"}>
        <text fg={theme.error} wrapMode="none" onMouseUp={onErrorClick}>
          {Locale.truncate(error() ?? "failed", 80)}
        </text>
      </Show>
      <Show when={status() === "completed" && !showPrompt()}>
        <text fg={theme.textMuted}>done</text>
      </Show>
      <Show when={showChips() && tokens() > 0}>
        <text fg={theme.textMuted}>· {formatTokens(tokens())} tok</text>
      </Show>
      <Show when={showChips() && cost() > 0}>
        <text fg={theme.textMuted}>· {money.format(cost())}</text>
      </Show>
      <text fg={theme.textMuted}>{formatDuration(secs())}</text>
    </box>
  )
}

export * as WorkflowWorkerRow from "./worker-row"