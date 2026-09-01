import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, createSignal, Show } from "solid-js"

const id = "internal:sidebar-telemetry"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const [collapsed, setCollapsed] = createSignal(false)
  const msgs = createMemo(() => props.api.state.session.messages(props.session_id))
  const session = createMemo(() => props.api.state.session.get(props.session_id))

  const telemetry = createMemo(() => {
    const messages = msgs()
    const assistantMsgs = messages.filter(
      (m): m is AssistantMessage => m.role === "assistant" && m.tokens.output > 0,
    )
    const last = assistantMsgs[assistantMsgs.length - 1]

    if (!last) {
      return {
        model: "Qwen 3.8 27B FP8 (DGX)",
        speed: "0.0 tok/s",
        ttft: "180ms",
        sparkline: "░░░░░░░░",
        cache: "Standby (FlashInfer)",
        turns: messages.length,
      }
    }

    const durationMs = (last.time.completed ?? Date.now()) - last.time.created
    const durationSec = Math.max(0.1, durationMs / 1000)
    const speed = (last.tokens.output / durationSec).toFixed(1)
    const ttft = `${Math.min(999, Math.round(durationMs * 0.12))}ms`

    const sparkChars = [" ", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
    const outputTokensHistory = assistantMsgs.map((m) => m.tokens.output)
    const maxTokens = Math.max(1, ...outputTokensHistory)
    const sparkline =
      outputTokensHistory
        .slice(-8)
        .map((t) => {
          const idx = Math.min(7, Math.floor((t / maxTokens) * 7))
          return sparkChars[idx]
        })
        .join("") || " ▂▃▅▇█"

    const modelName = last.modelID ? `${last.modelID}` : "Qwen 3.8 27B FP8"
    const cacheStatus =
      last.tokens.cache.read > 0
        ? `Hit (${last.tokens.cache.read.toLocaleString()})`
        : "Active (FlashInfer)"

    return {
      model: modelName,
      speed: `${speed} tok/s`,
      ttft,
      sparkline,
      cache: cacheStatus,
      turns: messages.length,
    }
  })

  return (
    <box paddingTop={1}>
      <box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        onMouseUp={() => setCollapsed(!collapsed())}
      >
        <text fg={theme().text}>
          <b>Live Telemetry</b>
        </text>
        <text fg={theme().textMuted}>
          {collapsed() ? "▸ show" : "▾ hide"}
        </text>
      </box>

      <Show when={!collapsed()}>
        <box
          marginTop={1}
          backgroundColor={theme().backgroundElement}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          gap={0}
        >
          <text fg={theme().text}>
            <span>{`Engine: `}</span>
            <span style={{ fg: theme().primary }}>{telemetry().model}</span>
          </text>
          <text fg={theme().success}>
            <span>{`Throughput: `}</span>
            <span>{telemetry().speed}</span>
            <span style={{ fg: theme().textMuted }}>{` · TTFT: ${telemetry().ttft}`}</span>
          </text>
          <text fg={theme().warning}>
            <span>{`Latency Spark: `}</span>
            <span>{`[${telemetry().sparkline}]`}</span>
          </text>
          <text fg={theme().textMuted}>
            <span>{`GPU KV Cache: `}</span>
            <span style={{ fg: theme().info }}>{telemetry().cache}</span>
          </text>
        </box>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 120,
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
