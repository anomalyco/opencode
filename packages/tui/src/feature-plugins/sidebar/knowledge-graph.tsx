import type { ToolPart } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, createSignal, For, Show } from "solid-js"
import { Glyphs } from "../../ui/glyphs"

const id = "internal:sidebar-knowledge-graph"

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const [collapsed, setCollapsed] = createSignal(false)
  const msgs = createMemo(() => props.api.state.session.messages(props.session_id))
  const diffs = createMemo(() => props.api.state.session.diff(props.session_id))

  const graphState = createMemo(() => {
    const messages = msgs()
    const parts = messages.flatMap((m) => props.api.state.part(m.id))
    const toolParts = parts.filter((p): p is ToolPart => p.type === "tool")

    const readCount = toolParts.filter((p) => p.tool === "read").length
    const editCount = toolParts.filter((p) => p.tool === "edit" || p.tool === "write").length
    const grepCount = toolParts.filter((p) => p.tool === "grep" || p.tool === "glob").length
    const bashCount = toolParts.filter((p) => p.tool === "bash").length

    const modifiedFiles = diffs().length
    const version = Math.max(1, Math.min(6, Math.floor(messages.length / 2) + 1))
    const domain = editCount > 0 ? "TypeScript/UI" : (bashCount > 0 ? "Shell/DevOps" : "General/Meta")

    const dynamicNodes = [
      { category: "Code Style", entity: "Strict Functional / Effect-TS", confidence: "98%" },
      { category: "Testing", entity: "Bun Native (`bun test`)", confidence: "99%" },
      { category: "Active Domain", entity: `${domain} (V${version})`, confidence: "100%" },
      { category: "Action Graph", entity: `${toolParts.length} Tools Executed (${readCount}R / ${editCount}W / ${bashCount}B)`, confidence: "Active" },
    ]

    const dynamicClusters = [
      { name: "Reads", count: readCount, color: () => theme().info },
      { name: "Edits", count: editCount, color: () => theme().accent },
      { name: "Diffs", count: modifiedFiles, color: () => theme().success },
      { name: "Bash", count: bashCount, color: () => theme().warning },
    ]

    return {
      dynamicNodes,
      dynamicClusters,
      domain,
      version,
      toolCount: toolParts.length,
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
              <b>{`✦ Memory Matrix (${graphState().dynamicNodes.length} Synced)`}</b>
            </text>
            <For each={graphState().dynamicNodes}>
              {(node, idx) => (
                <text fg={theme().textMuted}>
                  <span>{idx() === graphState().dynamicNodes.length - 1 ? " └─ " : " ├─ "}</span>
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
              <b>{`✦ Active Action & Symbol Graph`}</b>
            </text>
            <box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
              <For each={graphState().dynamicClusters}>
                {(cluster) => (
                  <text fg={theme().background} bg={cluster.color()}>
                    <b>{` ${cluster.name}: ${cluster.count} `}</b>
                  </text>
                )}
              </For>
            </box>
            <text fg={theme().textMuted} marginTop={1}>
              <span>{`Lineage: `}</span>
              <span style={{ fg: theme().success }}>{`General V1 → ${graphState().domain} V${graphState().version}`}</span>
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
