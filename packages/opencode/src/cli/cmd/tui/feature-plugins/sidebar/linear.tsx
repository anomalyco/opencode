import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createMemo, createResource, createSignal, Show } from "solid-js"

const id = "internal:sidebar-linear"

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const mcpList = createMemo(() => props.api.state.mcp())
  const linearMcp = createMemo(() => mcpList().find((item) => item.name.toLowerCase().includes("linear")))
  const connected = createMemo(() => linearMcp()?.status === "connected")
  const projectId = createMemo(() => props.api.kv.get("linear:projectId"))
  const lastSync = createMemo(() => props.api.kv.get("linear:lastSync"))
  const pending = createMemo(() => props.api.kv.get("linear:pendingCount", 0))
  const [refreshKey, setRefreshKey] = createSignal(0)

  const fetcher = async () => {
    if (!connected()) return []
    return props.api.client.issue
      .list({ directory: props.api.state.path.directory })
      .then((res) => res.data ?? [])
      .catch(() => [])
  }
  const [data] = createResource(refreshKey, fetcher)
  const count = createMemo(() => (data() ?? []).length)

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
    <Show when={connected()}>
      <box>
        <box flexDirection="row" gap={1}>
          <text fg={theme().text}>
            <b>Linear</b>
          </text>
          <text flexGrow={1} />
          <text fg={theme().textMuted} onMouseDown={() => setRefreshKey((k) => k + 1)}>
            [↻]
          </text>
        </box>
        <box flexDirection="row" gap={1}>
          <text flexShrink={0} style={{ fg: connected() ? theme().success : theme().error }}>
            •
          </text>
          <text fg={theme().textMuted}>Connected</text>
        </box>
        <text fg={theme().textMuted}>Project: {projectId() || "Not configured"}</text>
        <text fg={theme().textMuted}>Sync: {syncStr()}</text>
        <text fg={theme().textMuted}>
          {count()} issue(s) | {pending()} pending
        </text>
        <box flexDirection="row" gap={1} paddingTop={1}>
          <text
            fg={theme().accent}
            onMouseDown={() => {
              props.api.ui.toast({
                title: "Linear",
                message: "Push is not yet wired — use /linear-push",
                variant: "info",
              })
            }}
          >
            [Push]
          </text>
          <text
            fg={theme().accent}
            onMouseDown={() => {
              props.api.ui.toast({
                title: "Linear",
                message: "Pull is not yet wired — use /linear-pull",
                variant: "info",
              })
            }}
          >
            [Pull]
          </text>
        </box>
      </box>
    </Show>
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
