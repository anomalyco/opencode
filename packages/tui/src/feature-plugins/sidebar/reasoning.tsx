import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, createSignal, For, Show } from "solid-js"

const id = "internal:sidebar-reasoning"

interface ReasoningLogEntry {
  id: string
  type: string
  content: string
  metadata?: Record<string, unknown>
  timestamp: number
}

function formatType(type: string) {
  switch (type) {
    case "why_loop":
      return "Why Loop"
    case "then_loop":
      return "Then Loop"
    case "pre_action":
      return "Pre-Action"
    case "counterfactual":
      return "Pre-Mortem"
    case "hypothesis_update":
      return "Hypothesis"
    case "evi_score":
      return "EVI Score"
    case "self_consistency":
      return "Consensus"
    case "temporal_guard":
      return "Invariant"
    default:
      return type
  }
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const session = createMemo(() => props.api.state.session.get(props.session_id))
  const reasoningLog = createMemo(() => {
    const s = session()
    const raw = (s?.metadata as Record<string, unknown> | undefined)?.reasoningLog
    return (Array.isArray(raw) ? raw : []) as ReasoningLogEntry[]
  })

  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={() => setOpen((x) => !x)}>
        <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
        <text fg={theme().text}>
          <b>Reasoning Logs</b>
        </text>
        <Show when={reasoningLog().length > 0}>
          <text fg={theme().textMuted}>({reasoningLog().length})</text>
        </Show>
      </box>
      <Show when={open()}>
        <Show
          when={reasoningLog().length > 0}
          fallback={<text fg={theme().textMuted}>  No reasoning events yet</text>}
        >
          <For each={reasoningLog().slice(-5).reverse()}>
            {(entry) => (
              <box paddingLeft={1} paddingTop={0} paddingBottom={0}>
                <text fg={theme().primary}>
                  <b>{formatType(entry.type)}</b>
                  <span style={{ fg: theme().textMuted }}> ({new Date(entry.timestamp).toLocaleTimeString()})</span>
                </text>
                <text fg={theme().text}>
                  {entry.content.slice(0, 120)}{entry.content.length > 120 ? "…" : ""}
                </text>
              </box>
            )}
          </For>
        </Show>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 350,
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
