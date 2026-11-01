import type { SessionMessageAssistant } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { createMemo, createSignal, For, Show } from "solid-js"

function elapsed(start: number, end?: number) {
  const seconds = Math.max(0, Math.floor(((end ?? Date.now()) - start) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

function compact(num: number) {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`
  return String(num)
}

function tokens(context: Plugin.Context, sessionID: string) {
  const last = context.data.session
    .message.list(sessionID)
    .findLast((item): item is SessionMessageAssistant => item.type === "assistant" && (item.tokens?.output ?? 0) > 0)
  if (!last?.tokens) return undefined
  return (
    last.tokens.input +
    last.tokens.output +
    last.tokens.reasoning +
    last.tokens.cache.read +
    last.tokens.cache.write
  )
}

function sessionEnd(context: Plugin.Context, sessionID: string) {
  const last = context.data.session
    .message.list(sessionID)
    .findLast((item): item is SessionMessageAssistant => item.type === "assistant" && item.time.completed !== undefined)
  return last?.time.completed
}

type Item = {
  id: string
  sessionID: string
  title: string
  agent?: string
  start: number
  end?: number
  running: boolean
  tokens?: number
}

function Row(props: { context: Plugin.Context; item: Item }) {
  const theme = props.context.theme
  const [hover, setHover] = createSignal(false)

  return (
    <box
      flexDirection="row"
      gap={1}
      justifyContent="space-between"
      backgroundColor={hover() ? theme.background.raised.high : undefined}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => props.context.ui.router.navigate({ type: "session", sessionID: props.item.sessionID })}
    >
      <box flexDirection="row" gap={1}>
        <text fg={props.item.running ? theme.text.feedback.success.base : theme.text.muted}>
          {props.item.running ? "●" : "○"}
        </text>
        <text fg={theme.text.muted} wrapMode="none">
          {props.item.title}
        </text>
      </box>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <Show when={props.item.agent}>
          <text fg={theme.text.muted}>{props.item.agent}</text>
        </Show>
        <text fg={theme.text.muted}>{props.item.tokens === undefined ? "—" : compact(props.item.tokens)}</text>
        <text fg={props.item.running ? theme.text.feedback.success.base : theme.text.muted}>
          {elapsed(props.item.start, props.item.end)}
        </text>
      </box>
    </box>
  )
}

function mainItem(context: Plugin.Context, sessionID: string): Item {
  const session = context.data.session.get(sessionID)
  const last = context.data.session
    .message.list(sessionID)
    .findLast((item): item is SessionMessageAssistant => item.type === "assistant" && (item.tokens?.output ?? 0) > 0)
  const running = context.data.session.status(sessionID) === "running"
  return {
    id: sessionID,
    sessionID,
    title: session?.title ?? "Main session",
    agent: "main",
    start: last?.time.created ?? session?.time.created ?? Date.now(),
    end: running ? undefined : last?.time.completed,
    running,
    tokens: tokens(context, sessionID),
  }
}

export function SidebarBackground(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const sessionID = createMemo(() => props.context.data.session.root(props.sessionID))
  const tasks = createMemo(() =>
    props.context.data.session
      .message.list(sessionID())
      .flatMap((message) => {
        if (message.type !== "assistant") return []
        return message.content.flatMap((part) => {
          if (part.type !== "tool" || part.name !== "subagent" || part.state.status !== "completed") return []
          const metadata = part.state.metadata
          if (metadata?.status !== "running" || typeof metadata.sessionID !== "string") return []
          const running = props.context.data.session.status(metadata.sessionID) === "running"
          const input = part.state.input
          return [
            {
              id: part.id,
              sessionID: metadata.sessionID,
              title: typeof input.description === "string" ? input.description : "Background task",
              agent: typeof input.agent === "string" ? input.agent : undefined,
              start: part.time.created,
              end: running ? undefined : sessionEnd(props.context, metadata.sessionID),
              running,
              tokens: tokens(props.context, metadata.sessionID),
            },
          ]
        })
      })
      .sort((a, b) => {
        if (a.running !== b.running) return a.running ? -1 : 1
        return b.start - a.start
      }),
  )
  const list = createMemo(() => [mainItem(props.context, sessionID()), ...tasks()])
  const running = createMemo(() => list().filter((item) => item.running).length)

  return (
    <Show when={list().length > 0}>
      <box>
        <box flexDirection="row" gap={1}>
          <text fg={theme.text.base}>
            <b>Agents</b>
          </text>
          <text fg={theme.text.muted}>
            ({running() > 0 ? `${running()} running / ${list().length}` : list().length})
          </text>
        </box>
        <For each={list()}>{(item) => <Row context={props.context} item={item} />}</For>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.background",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarBackground context={context} sessionID={props.sessionID} />,
    })
  },
})
