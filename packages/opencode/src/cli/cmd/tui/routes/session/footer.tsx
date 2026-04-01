import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/dialog-model"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import type { Session, AssistantMessage } from "@opencode-ai/sdk/v2"

// Permission mode display labels and colors
const PERMISSION_MODE_INFO: Record<string, { label: string; color: string }> = {
  default: { label: "Default", color: "textMuted" },
  plan: { label: "Plan", color: "warning" },
  acceptEdits: { label: "Edit", color: "success" },
  bypassPermissions: { label: "Bypass", color: "error" },
}

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

  // Get current session's permission mode
  const permissionMode = createMemo(() => {
    if (route.data.type !== "session") return "default"
    const sessionID = route.data.sessionID
    const session = sync.data.session.find((s: Session) => s.id === sessionID)
    return (session as any)?.permissionMode ?? "default"
  })

  const permissionModeInfo = createMemo(() => {
    const mode = permissionMode()
    return PERMISSION_MODE_INFO[mode] ?? PERMISSION_MODE_INFO.default
  })

  const permissionModeColor = createMemo(() => {
    const colorName = permissionModeInfo().color
    if (colorName === "warning") return theme.warning
    if (colorName === "success") return theme.success
    if (colorName === "error") return theme.error
    return theme.textMuted
  })

  // Budget display: turns used/max, cost used/max
  const budget = createMemo(() => {
    if (route.data.type !== "session") return null
    const cfg = sync.data.config as any
    const maxTurns: number | undefined = cfg?.budget?.maxTurns
    const maxUsd: number | undefined = cfg?.budget?.maxUsd
    if (!maxTurns && !maxUsd) return null

    const msgs = sync.data.message[route.data.sessionID] ?? []
    const turns = msgs.filter((m) => m.role === "assistant").length
    const cost = msgs.reduce((s, m) => s + (m.role === "assistant" ? (m as AssistantMessage).cost : 0), 0)

    const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 })

    const parts: string[] = []
    if (maxTurns) parts.push(`${turns}/${maxTurns} turns`)
    if (maxUsd) parts.push(`${money.format(cost)}/${money.format(maxUsd)}`)
    return parts.join(" · ")
  })

  const budgetExceeded = createMemo(() => {
    if (route.data.type !== "session") return false
    const cfg = sync.data.config as any
    const maxTurns: number | undefined = cfg?.budget?.maxTurns
    const maxUsd: number | undefined = cfg?.budget?.maxUsd
    const msgs = sync.data.message[route.data.sessionID] ?? []
    const turns = msgs.filter((m) => m.role === "assistant").length
    const cost = msgs.reduce((s, m) => s + (m.role === "assistant" ? (m as AssistantMessage).cost : 0), 0)
    return (maxTurns !== undefined && turns >= maxTurns) || (maxUsd !== undefined && cost >= maxUsd)
  })

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
    // Track all timeouts to ensure proper cleanup
    const timeouts: ReturnType<typeof setTimeout>[] = []

    function tick() {
      if (connected()) return
      if (!store.welcome) {
        setStore("welcome", true)
        timeouts.push(setTimeout(() => tick(), 5000))
        return
      }

      if (store.welcome) {
        setStore("welcome", false)
        timeouts.push(setTimeout(() => tick(), 10_000))
        return
      }
    }
    timeouts.push(setTimeout(() => tick(), 10_000))

    onCleanup(() => {
      timeouts.forEach(clearTimeout)
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
            <Show when={budget()}>
              {(b) => <text fg={budgetExceeded() ? theme.error : theme.textMuted}>{b()}</text>}
            </Show>
            <Show when={permissionMode() !== "default"}>
              <text fg={permissionModeColor()}>{permissionModeInfo().label}</text>
            </Show>
            <text fg={theme.text}>
              <span style={{ fg: lsp().length > 0 ? theme.success : theme.textMuted }}>•</span> {lsp().length} LSP
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
