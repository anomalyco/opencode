import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { PermissionDecision } from "@opencode-ai/sdk/v2"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show, createSignal } from "solid-js"
import { Locale } from "../../util/locale"

const id = "internal:sidebar-auto"

function Row(props: { api: TuiPluginApi; item: PermissionDecision }) {
  const [open, setOpen] = createSignal(false)
  const theme = () => props.api.theme.current
  const verdict = createMemo(() => {
    if (props.item.verdict === "allow") return { icon: "✓", fg: theme().success }
    if (props.item.verdict === "deny") return { icon: "✕", fg: theme().error }
    if (props.item.verdict === "uncertain") return { icon: "?", fg: theme().warning }
    return { icon: "↩", fg: theme().textMuted }
  })
  const title = createMemo(() => props.item.patterns[0] ?? props.item.permission)

  return (
    <box onMouseDown={() => setOpen((x) => !x)}>
      <box flexDirection="row" gap={1}>
        <text fg={verdict().fg} flexShrink={0}>
          {open() ? "▼" : "▶"}
          {verdict().icon}
        </text>
        <text fg={theme().textMuted} wrapMode="none">
          {Locale.truncateLeft(`${props.item.permission}: ${title()}`, 34)}
        </text>
      </box>
      <Show when={open()}>
        <box paddingLeft={3}>
          <text fg={theme().text}>
            {props.item.verdict} · {props.item.model} · {String(props.item.latency_ms)}ms
          </text>
          <Show when={props.item.reason}>
            <text fg={theme().textMuted}>{props.item.reason}</text>
          </Show>
          <text fg={theme().textMuted}>{Locale.time(Number(props.item.created_at))}</text>
        </box>
      </Show>
    </box>
  )
}

function Summary(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(false)
  const theme = () => props.api.theme.current
  const summary = createMemo(() => props.api.state.session.autoSummary(props.session_id))

  return (
    <Show when={summary()}>
      {(item) => (
        <box onMouseDown={() => setOpen((x) => !x)}>
          <box flexDirection="row" gap={1}>
            <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
            <text fg={theme().textMuted}>
              session summary · turn {item().turn_count} · {item().model.split("/").pop()}
            </text>
          </box>
          <Show when={open()}>
            <box paddingLeft={3}>
              <text fg={theme().text}>{item().summary}</text>
              <text fg={theme().textMuted}>updated {Locale.time(Number(item().updated_at))}</text>
            </box>
          </Show>
        </box>
      )}
    </Show>
  )
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.session.decisions(props.session_id))
  const hasSummary = createMemo(() => props.api.state.session.autoSummary(props.session_id) != null)
  const summary = createMemo(() => {
    const counts = { allow: 0, deny: 0, uncertain: 0, fallback: 0 }
    for (const item of list()) counts[item.verdict]++
    return [
      counts.allow ? `${counts.allow} allow` : "",
      counts.deny ? `${counts.deny} deny` : "",
      counts.uncertain ? `${counts.uncertain} uncertain` : "",
      counts.fallback ? `${counts.fallback} fallback` : "",
    ]
      .filter(Boolean)
      .join(" · ")
  })

  return (
    <Show when={list().length > 0 || hasSummary()}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => setOpen((x) => !x)}>
          <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          <text fg={theme().text}>
            <b>Auto</b>
          </text>
          <text fg={theme().textMuted}>{summary()}</text>
        </box>
        <Show when={open()}>
          <Summary api={props.api} session_id={props.session_id} />
          <For each={list()}>{(item) => <Row api={props.api} item={item} />}</For>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 300,
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
