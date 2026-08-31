import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, createSignal, For, Show } from "solid-js"
import { Glyphs } from "../../ui/glyphs"

const id = "internal:sidebar-knowledge-graph"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const [collapsed, setCollapsed] = createSignal(false)

  const knowledgeNodes = [
    { category: "Code Style", entity: "Strict Functional / Effect-TS", confidence: "98%" },
    { category: "Architecture", entity: "Domain-Driven / Clean Layers", confidence: "95%" },
    { category: "Testing", entity: "Bun Native Test Runner", confidence: "99%" },
    { category: "Lineage", entity: "Quality Gate V2 (Self-Evolving)", confidence: "100%" },
  ]

  const symbolClusters = [
    { name: "Core", count: 42, color: () => theme().primary },
    { name: "TUI", count: 28, color: () => theme().accent },
    { name: "Harness", count: 16, color: () => theme().success },
  ]

  return (
    <box paddingTop={1}>
      <box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        onMouseUp={() => setCollapsed(!collapsed())}
      >
        <text fg={theme().text}>
          <b>Knowledge Graph</b>
        </text>
        <text fg={theme().textMuted}>
          {collapsed() ? "▸ show" : "▾ hide"}
        </text>
      </box>

      <Show when={!collapsed()}>
        <box marginTop={1} gap={1}>
          {/* Active Memory Matrix */}
          <box
            backgroundColor={theme().backgroundElement}
            paddingLeft={1}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
          >
            <text fg={theme().accent}>
              <b>{`✦ Memory Matrix (4 Synced)`}</b>
            </text>
            <For each={knowledgeNodes}>
              {(node, idx) => (
                <text fg={theme().textMuted}>
                  <span>{idx() === knowledgeNodes.length - 1 ? " └─ " : " ├─ "}</span>
                  <span style={{ fg: theme().text }}>{`[${node.category}] `}</span>
                  <span>{node.entity}</span>
                </text>
              )}
            </For>
          </box>

          {/* Symbol Map Clusters */}
          <box
            backgroundColor={theme().backgroundElement}
            paddingLeft={1}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
          >
            <text fg={theme().info}>
              <b>{`✦ Symbol Graph Map`}</b>
            </text>
            <box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
              <For each={symbolClusters}>
                {(cluster) => (
                  <text fg={theme().background} bg={cluster.color()}>
                    <b>{` ${cluster.name} · ${cluster.count} `}</b>
                  </text>
                )}
              </For>
            </box>
            <text fg={theme().textMuted} marginTop={1}>
              <span>{`Lineage: `}</span>
              <span style={{ fg: theme().success }}>{`General V1 → Domain V2`}</span>
            </text>
          </box>
        </box>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 150,
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
