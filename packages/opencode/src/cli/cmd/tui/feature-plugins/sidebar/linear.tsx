import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo } from "solid-js"

const id = "internal:sidebar-linear"

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const mcpList = createMemo(() => props.api.state.mcp())
  const linearMcp = createMemo(() => mcpList().find((item) => item.name.toLowerCase().includes("linear")))
  const connected = createMemo(() => linearMcp()?.status === "connected")
  const projectId = createMemo(() => props.api.kv.get("linear:projectId"))
  const lastSync = createMemo(() => props.api.kv.get("linear:lastSync"))
  const pending = createMemo(() => props.api.kv.get("linear:pendingCount", 0))
  const syncStr = createMemo(() => {
    const raw = lastSync()
    if (!raw) return "Never"
    try {
      return new Date(String(raw)).toLocaleString()
    } catch {
      return raw
    }
  })

  return (
    <box>
      <text fg={theme().text}>
        <b>Linear</b>
      </text>
      <box flexDirection="row" gap={1}>
        <text flexShrink={0} style={{ fg: connected() ? theme().success : theme().error }}>
          •
        </text>
        <text fg={theme().textMuted}>{connected() ? "Connected" : "Disconnected"}</text>
      </box>
      <text fg={theme().textMuted}>Project: {projectId() || "Not configured"}</text>
      <text fg={theme().textMuted}>Sync: {syncStr()}</text>
      <text fg={theme().textMuted}>{pending()} pending</text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 250,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
