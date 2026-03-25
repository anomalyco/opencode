import { createEffect, createMemo, Match, on, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/dialog-model"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { formatTokenCount, formatTps } from "../../util/tokens"

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

  // Compute cumulative token stats for the current session
  const tokenStats = createMemo(() => {
    if (route.data.type !== "session") return null
    const messages = sync.data.message[route.data.sessionID] ?? []
    let inputTokens = 0
    let outputTokens = 0
    for (const msg of messages) {
      if (msg.role !== "assistant") continue
      const am = msg as AssistantMessage
      if (!am.tokens) continue
      inputTokens += am.tokens.input ?? 0
      outputTokens += am.tokens.output ?? 0
    }
    if (inputTokens === 0 && outputTokens === 0) return null
    return { inputTokens, outputTokens }
  })

  // Track streaming tokens-per-second
  const [tpsStore, setTpsStore] = createStore({
    /** Current or last-computed TPS rate */
    tps: 0,
    /** Whether to show TPS in the footer (true during streaming + 3s after) */
    showTps: false,
  })

  // Internal tracking for TPS calculation (not reactive)
  let prevOutputTokens = 0
  let prevTimestamp = 0
  let tpsTimeout: ReturnType<typeof setTimeout> | undefined

  const sessionStatus = createMemo(() => {
    if (route.data.type !== "session") return undefined
    return sync.data.session_status[route.data.sessionID]
  })

  const isStreaming = createMemo(() => sessionStatus()?.type === "busy")

  // Find the last assistant message's output token count (reactive)
  const lastAssistantOutputTokens = createMemo(() => {
    if (route.data.type !== "session") return 0
    const messages = sync.data.message[route.data.sessionID] ?? []
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === "assistant") {
        return (msg as AssistantMessage).tokens?.output ?? 0
      }
    }
    return 0
  })

  // Update TPS when output tokens change during streaming (effect, not memo)
  createEffect(
    on([isStreaming, lastAssistantOutputTokens], ([streaming, outputTokens]) => {
      if (!streaming || outputTokens === 0) return

      const now = Date.now()
      if (prevOutputTokens > 0 && prevTimestamp > 0 && outputTokens > prevOutputTokens) {
        const elapsed = (now - prevTimestamp) / 1000
        if (elapsed > 0) {
          setTpsStore("tps", (outputTokens - prevOutputTokens) / elapsed)
          setTpsStore("showTps", true)
        }
      }
      prevOutputTokens = outputTokens
      prevTimestamp = now
    }),
  )

  // When streaming stops, keep TPS visible for 3 seconds then hide
  createEffect(
    on(isStreaming, (streaming) => {
      if (!streaming && tpsStore.showTps) {
        clearTimeout(tpsTimeout)
        tpsTimeout = setTimeout(() => {
          setTpsStore("showTps", false)
          prevOutputTokens = 0
          prevTimestamp = 0
        }, 3000)
      }
    }),
  )

  onCleanup(() => clearTimeout(tpsTimeout))

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
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
            <Show when={tokenStats()}>
              {(stats) => (
                <text fg={theme.textMuted}>
                  <Show when={tpsStore.showTps && tpsStore.tps > 0}>
                    <span style={{ fg: isStreaming() ? theme.text : theme.textMuted }}>
                      {formatTps(tpsStore.tps)} tok/s
                    </span>
                    {" · "}
                  </Show>
                  {formatTokenCount(stats().inputTokens)} in · {formatTokenCount(stats().outputTokens)} out
                </text>
              )}
            </Show>
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>△</span> {permissions().length} Permission
                {permissions().length > 1 ? "s" : ""}
              </text>
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
