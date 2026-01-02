import { createMemo, Match, onCleanup, onMount, Show, Switch, For } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/dialog-model"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import type { StatusColor } from "@/status/registry"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const connected = useConnected()

  const pluginStatus = createMemo(() => {
    const items = Object.values(sync.data.pluginStatus)
    return items
      .filter((item) => item.short !== null)
      .map((item) => ({
        id: item.id,
        render: item.short!,
        priority: item.priority,
      }))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  })

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
    function tick() {
      if (connected()) return
      if (!store.welcome) {
        setStore("welcome", true)
        timeout = setTimeout(() => tick(), 5000)
        return
      }

      if (store.welcome) {
        setStore("welcome", false)
        timeout = setTimeout(() => tick(), 10_000)
        return
      }
    }
    let timeout = setTimeout(() => tick(), 10_000)

    onCleanup(() => {
      clearTimeout(timeout)
    })
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <text fg={theme.textMuted}>{directory()}</text>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome}>
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.textMuted }}>/connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>△</span> {permissions().length} Permission
                {permissions().length > 1 ? "s" : ""}
              </text>
            </Show>
            <For each={pluginStatus()}>
              {(item) => {
                const color = item.render.color ?? "default"
                const colorMap = {
                  default: theme.text,
                  green: theme.success,
                  yellow: theme.warning,
                  red: theme.error,
                  blue: theme.info,
                  gray: theme.textMuted,
                }
                const textColor = colorMap[color]
                return (
                  <text fg={textColor}>
                    <span style={{ fg: textColor }}>
                      {item.render.icon ?? ""}
                      {item.render.icon ? " " : ""}
                      {item.render.text}
                    </span>
                  </text>
                )
              }}
            </For>
            <text fg={theme.text}>
              <span style={{ fg: theme.success }}>•</span> {lsp().length} LSP
            </text>
            <Show when={mcp()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.error }}>⊙ </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>⊙ </span>
                  </Match>
                </Switch>
                {mcp()} MCP
              </text>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
