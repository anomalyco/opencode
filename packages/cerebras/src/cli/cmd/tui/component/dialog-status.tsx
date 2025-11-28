import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useSync } from "@tui/context/sync"
import { For, Match, Switch, Show, createMemo } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { pipe, sumBy } from "remeda"

export type DialogStatusProps = {}

export function DialogStatus() {
  const sync = useSync()
  const { theme } = useTheme()
  const route = useRouteData("session")

  const enabledFormatters = createMemo(() => sync.data.formatter.filter((f) => f.enabled))

  // Calculate session token metrics
  const sessionMetrics = createMemo(() => {
    if (!route?.sessionID) return null
    const messages = sync.data.message[route.sessionID] ?? []

    const totalTokens = pipe(
      messages,
      sumBy((x) => {
        if (x.role === "assistant") {
          return x.tokens.input + x.tokens.output + x.tokens.reasoning + x.tokens.cache.read + x.tokens.cache.write
        }
        return 0
      }),
    )

    const cacheHits = pipe(
      messages,
      sumBy((x) => (x.role === "assistant" ? x.tokens.cache.read : 0)),
    )

    const totalInputOutput = pipe(
      messages,
      sumBy((x) => (x.role === "assistant" ? x.tokens.input + x.tokens.output : 0)),
    )

    const cacheHitRate = totalInputOutput > 0 ? (cacheHits / (cacheHits + totalInputOutput)) * 100 : 0

    const requestCount = messages.filter((x) => x.role === "assistant").length

    return {
      totalTokens,
      requestCount,
      cacheHitRate,
      avgTokensPerRequest: requestCount > 0 ? Math.round(totalTokens / requestCount) : 0,
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Status
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      {/* Token Metrics Section */}
      <Show when={sessionMetrics()}>
        {(metrics) => (
          <box gap={0}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              📊 Session Metrics
            </text>
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>•</text>
              <text fg={theme.text}>
                Total Tokens: <span style={{ fg: theme.accent }}>{metrics().totalTokens.toLocaleString()}</span>
              </text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>•</text>
              <text fg={theme.text}>
                Requests: <span style={{ fg: theme.accent }}>{metrics().requestCount}</span>
              </text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>•</text>
              <text fg={theme.text}>
                Avg Tokens/Request:{" "}
                <span style={{ fg: theme.accent }}>{metrics().avgTokensPerRequest.toLocaleString()}</span>
              </text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>•</text>
              <text fg={theme.text}>
                Cache Hit Rate:{" "}
                <span
                  style={{
                    fg:
                      metrics().cacheHitRate > 50
                        ? theme.success
                        : metrics().cacheHitRate > 20
                          ? theme.warning
                          : theme.textMuted,
                  }}
                >
                  {metrics().cacheHitRate.toFixed(1)}%
                </span>
              </text>
            </box>
          </box>
        )}
      </Show>

      <Show when={Object.keys(sync.data.mcp).length > 0} fallback={<text>No MCP Servers</text>}>
        <box>
          <text fg={theme.text}>{Object.keys(sync.data.mcp).length} MCP Servers</text>
          <For each={Object.entries(sync.data.mcp)}>
            {([key, item]) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: {
                      connected: theme.success,
                      failed: theme.error,
                      disabled: theme.textMuted,
                    }[item.status],
                  }}
                >
                  •
                </text>
                <text fg={theme.text} wrapMode="word">
                  <b>{key}</b>{" "}
                  <span style={{ fg: theme.textMuted }}>
                    <Switch>
                      <Match when={item.status === "connected"}>Connected</Match>
                      <Match when={item.status === "failed" && item}>{(val) => val().error}</Match>
                      <Match when={item.status === "disabled"}>Disabled in configuration</Match>
                    </Switch>
                  </span>
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
      {sync.data.lsp.length > 0 && (
        <box>
          <text fg={theme.text}>{sync.data.lsp.length} LSP Servers</text>
          <For each={sync.data.lsp}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: {
                      connected: theme.success,
                      error: theme.error,
                    }[item.status],
                  }}
                >
                  •
                </text>
                <text fg={theme.text} wrapMode="word">
                  <b>{item.id}</b> <span style={{ fg: theme.textMuted }}>{item.root}</span>
                </text>
              </box>
            )}
          </For>
        </box>
      )}
      <Show when={enabledFormatters().length > 0} fallback={<text fg={theme.text}>No Formatters</text>}>
        <box>
          <text fg={theme.text}>{enabledFormatters().length} Formatters</text>
          <For each={enabledFormatters()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: theme.success,
                  }}
                >
                  •
                </text>
                <text wrapMode="word" fg={theme.text}>
                  <b>{item.name}</b>
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}
