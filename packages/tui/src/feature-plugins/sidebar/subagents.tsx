import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { Locale } from "../../util/locale"

const id = "internal:sidebar-subagents"

type Session = NonNullable<ReturnType<TuiPluginApi["state"]["session"]["get"]>>

export function formatSubagentDuration(input: number) {
  const total = Math.max(0, Math.floor(input / 1_000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3_600)
  const paddedSeconds = seconds.toString().padStart(2, "0")

  if (hours > 0) return `${hours}h ${minutes}m ${paddedSeconds}s`
  if (minutes > 0) return `${minutes}m ${paddedSeconds}s`
  return `${seconds}s`
}

export function subagentLabel(session: Pick<Session, "agent" | "title">) {
  const titleAgent = session.title.match(/\(@(.+?) subagent\)$/i)?.[1]
  return Locale.titlecase((session.agent ?? titleAgent ?? "Subagent").replaceAll(/[-_]+/g, " "))
}

export function isSubagentActive(status: ReturnType<TuiPluginApi["state"]["session"]["status"]>) {
  return status?.type === "busy" || status?.type === "retry"
}

function hash(value: string) {
  let result = 0
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) >>> 0
  return result
}

function Card(props: { api: TuiPluginApi; item: Session; now: number }) {
  const theme = () => props.api.theme.current
  const status = createMemo(() => props.api.state.session.status(props.item.id))
  const running = createMemo(() => isSubagentActive(status()))
  const duration = createMemo(() => {
    const end = running() ? props.now : Math.max(props.item.time.updated, props.item.time.created)
    return formatSubagentDuration(end - props.item.time.created)
  })
  const color = createMemo(() => {
    if (status()?.type === "retry") return theme().error
    const colors = [theme().primary, theme().success, theme().accent, theme().warning, theme().info, theme().secondary]
    return colors[hash(props.item.agent ?? props.item.id) % colors.length]
  })

  return (
    <box
      width="100%"
      border
      borderStyle="rounded"
      borderColor={color()}
      backgroundColor={theme().backgroundElement}
      paddingLeft={1}
      paddingRight={1}
      onMouseUp={() => props.api.route.navigate("session", { sessionID: props.item.id })}
    >
      <text fg={color()} wrapMode="none">
        <b>{Locale.truncate(subagentLabel(props.item), 30)}</b>
      </text>
      <text fg={theme().textMuted} wrapMode="none">
        ◷ {duration()}
      </text>
    </box>
  )
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const rootID = createMemo(() => props.api.state.session.get(props.session_id)?.parentID ?? props.session_id)
  const [now, setNow] = createSignal(Date.now())
  const [children, { refetch }] = createResource(rootID, async (sessionID) => {
    const response = await props.api.client.session.children({ sessionID })
    return (response.data ?? []) as Session[]
  })
  const list = createMemo(() =>
    (children() ?? [])
      .filter((item) => isSubagentActive(props.api.state.session.status(item.id)))
      .toSorted((first, second) => second.time.created - first.time.created),
  )

  const relevant = (session: Session) => session.parentID === rootID() || session.id === rootID()
  const stops = [
    props.api.event.on("session.created", (event) => {
      if (relevant(event.properties.info)) void refetch()
    }),
    props.api.event.on("session.updated", (event) => {
      if (relevant(event.properties.info)) void refetch()
    }),
    props.api.event.on("session.deleted", (event) => {
      if (relevant(event.properties.info)) void refetch()
    }),
    props.api.event.on("session.idle", (event) => {
      if (event.properties.sessionID === rootID() || list().some((item) => item.id === event.properties.sessionID)) {
        void refetch()
      }
    }),
  ]
  const timer = setInterval(() => setNow(Date.now()), 1_000)

  onCleanup(() => {
    for (const stop of stops) stop()
    clearInterval(timer)
  })

  return (
    <box gap={1}>
      <text fg={theme().text}>
        <b>Subagents</b>
      </text>
      <Show when={!children.loading} fallback={<text fg={theme().textMuted}>Loading subagents…</text>}>
        <Show when={!children.error} fallback={<text fg={theme().error}>Unable to load subagents</text>}>
          <Show when={list().length > 0} fallback={<text fg={theme().textMuted}>No subagents yet</text>}>
            <For each={list()}>{(item) => <Card api={props.api} item={item} now={now()} />}</For>
          </Show>
        </Show>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 310,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
