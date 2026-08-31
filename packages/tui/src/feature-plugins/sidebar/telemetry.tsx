import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, createSignal, Show } from "solid-js"

const id = "internal:sidebar-telemetry"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const [collapsed, setCollapsed] = createSignal(false)

  const sparkline = " ▂▃▅▇█▇▅▃ "

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
            <span style={{ fg: theme().primary }}>{`DGX Qwen 27B FP8`}</span>
          </text>
          <text fg={theme().success}>
            <span>{`Throughput: `}</span>
            <span>{`54.2 tok/s`}</span>
            <span style={{ fg: theme().textMuted }}>{` · TTFT: 185ms`}</span>
          </text>
          <text fg={theme().warning}>
            <span>{`Latency Spark: `}</span>
            <span>{`[${sparkline}]`}</span>
          </text>
          <text fg={theme().textMuted}>
            <span>{`GPU KV Cache: `}</span>
            <span style={{ fg: theme().info }}>{`Optimized (FlashInfer)`}</span>
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
