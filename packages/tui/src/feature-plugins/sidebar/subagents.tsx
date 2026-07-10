import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Session } from "@opencode-ai/sdk/v2"
import { createMemo, createResource, For, Match, onCleanup, Show, Switch } from "solid-js"
import { useSync } from "../../context/sync"
import type { BuiltinTuiPlugin } from "../builtins"

const id = "internal:sidebar-subagents"

function title(item: Session) {
  const value = item.title?.replace(/\s*\(@[^)]* subagent\)\s*$/, "").trim()
  if (!value) return item.id.slice(0, 8)
  return value.length > 26 ? `${value.slice(0, 25)}...` : value
}

function View(props: { api: TuiPluginApi; sessionID: string }) {
  const theme = () => props.api.theme.current
  const sync = useSync()
  const [loaded, { refetch }] = createResource(
    () => props.sessionID,
    async (sessionID) => {
      const result = await props.api.client.session.children({ sessionID }, { throwOnError: true })
      return result.data ?? []
    },
  )
  const children = createMemo(() => {
    const items = new Map<string, Session>()
    for (const item of loaded() ?? []) items.set(item.id, item)
    for (const item of sync.data.session) {
      if (item.parentID === props.sessionID) items.set(item.id, item)
    }
    return [...items.values()].toSorted((a, b) => a.time.created - b.time.created)
  })
  const refresh = () => void refetch()
  const stopUpdated = props.api.event.on("session.updated", (event) => {
    if (event.properties.info.parentID !== props.sessionID) return
    refresh()
  })
  const stopDeleted = props.api.event.on("session.deleted", (event) => {
    if (!children().some((item) => item.id === event.properties.info.id)) return
    refresh()
  })
  onCleanup(() => {
    stopUpdated()
    stopDeleted()
  })
  const running = () => children().filter((item) => sync.data.session_status[item.id]?.type !== "idle")
  const idle = () => children().length - running().length

  return (
    <Show when={children().length > 0}>
      <box>
        <text fg={theme().text}>
          <b>Subagents</b>{" "}
          <span style={{ fg: running().length > 0 ? theme().warning : theme().textMuted }}>
            <Switch fallback={`${children().length} total`}>
              <Match when={running().length > 0}>
                {running().length} running{idle() > 0 ? `, ${idle()} done` : ""}
              </Match>
              <Match when={idle() > 0}>{idle()} done</Match>
            </Switch>
          </span>
        </text>
        <For each={children().slice(0, 5)}>
          {(item) => {
            const active = () => sync.data.session_status[item.id]?.type !== "idle"
            return (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} fg={active() ? theme().warning : theme().textMuted}>
                  {active() ? "•" : "✓"}
                </text>
                <text fg={theme().textMuted} wrapMode="word">
                  {title(item)}
                </text>
              </box>
            )
          }}
        </For>
        <Show when={children().length > 5}>
          <text fg={theme().textMuted}>+{children().length - 5} more</text>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} sessionID={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
