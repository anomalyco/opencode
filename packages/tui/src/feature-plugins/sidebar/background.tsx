import type { SessionMessageAssistant } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"

function elapsed(start: number, end: number | undefined, now: number) {
  const seconds = Math.max(0, Math.floor(((end ?? now) - start) / 1000))
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

function Row(props: { context: Plugin.Context; item: Item; now: number }) {
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
          {props.item.running || props.item.end !== undefined
            ? elapsed(props.item.start, props.item.end, props.now)
            : "—"}
        </text>
      </box>
    </box>
  )
}

function mainItem(context: Plugin.Context, sessionID: string, now: number): Item {
  const session = context.data.session.get(sessionID)
  const messages = context.data.session.message.list(sessionID)
  // The current turn starts at the latest prompt, not at the previous turn's
  // assistant message, so a running root does not inherit the last turn's clock.
  const start = messages.findLast((item) => item.type === "user" || item.type === "synthetic")?.time.created
  const turnStart = start ?? session?.time.created ?? now
  const last = messages.findLast(
    (item): item is SessionMessageAssistant =>
      item.type === "assistant" && item.time.created >= turnStart && item.time.completed !== undefined,
  )
  const running = context.data.session.status(sessionID) === "running"
  return {
    id: sessionID,
    sessionID,
    title: session?.title ?? "Main session",
    agent: "main",
    start: turnStart,
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
      .family(sessionID())
      .filter((id) => id !== sessionID())
      .flatMap((id) => {
        const session = props.context.data.session.get(id)
        if (!session) return []
        const running = props.context.data.session.status(id) === "running"
        return [
          {
            id,
            sessionID: id,
            title: session.title ?? "Background task",
            agent: session.agent,
            start: session.time.created,
            end: running ? undefined : session.time.updated,
            running,
            tokens: tokens(props.context, id),
          },
        ]
      })
      .sort((a, b) => {
        if (a.running !== b.running) return a.running ? -1 : 1
        return b.start - a.start
      }),
  )
  // A ticking signal keeps the live timers moving without relying on unrelated
  // re-renders. It only runs while something is actually running.
  const [now, setNow] = createSignal(Date.now())
  const list = createMemo(() => [mainItem(props.context, sessionID(), now()), ...tasks()])
  const running = createMemo(() => list().filter((item) => item.running).length)

  createEffect(() => {
    if (running() === 0) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show when={tasks().length > 0}>
      <box>
        <box flexDirection="row" gap={1}>
          <text fg={theme.text.base}>
            <b>Agents</b>
          </text>
          <text fg={theme.text.muted}>
            ({running() > 0 ? `${running()} running / ${list().length}` : list().length})
          </text>
        </box>
        <For each={list()}>{(item) => <Row context={props.context} item={item} now={now()} />}</For>
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
