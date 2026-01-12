import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { For, Match, Show, Switch, createResource, createSignal } from "solid-js"
import { Antigravity } from "@/antigravity"

export function DialogAntigravity() {
  const { theme } = useTheme()

  const [status, { refetch }] = createResource(async () => {
    const running = await Antigravity.isRunning()
    if (!running) {
      return { running: false, accounts: [], summary: "Proxy not running" }
    }
    return await Antigravity.getStatus()
  })

  const [limits] = createResource(
    () => status()?.running,
    async (running) => {
      if (!running) return null
      return await Antigravity.getAccountLimits()
    },
  )

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Antigravity Proxy
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <Show when={status.loading}>
        <text fg={theme.textMuted}>Checking proxy status...</text>
      </Show>

      <Show when={!status.loading}>
        <Switch>
          <Match when={!status()?.running}>
            <box gap={1}>
              <text fg={theme.warning}>Proxy is not running</text>
              <text fg={theme.textMuted} wrapMode="word">
                The Antigravity proxy provides free access to Claude and Gemini models via Google Cloud Code.
              </text>
              <text fg={theme.text} wrapMode="word">
                Start the proxy with: npx antigravity-claude-proxy start
              </text>
              <text fg={theme.textMuted} wrapMode="word">
                Then open http://localhost:8080 to add Google accounts.
              </text>
            </box>
          </Match>

          <Match when={status()?.running}>
            <box gap={1}>
              <box flexDirection="row" gap={1}>
                <text fg={theme.success}>●</text>
                <text fg={theme.text}>Proxy running on port 8080</text>
              </box>

              <text fg={theme.text}>{status()?.summary}</text>

              <Show when={limits() && limits()!.accounts.length > 0}>
                <box marginTop={1}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    Accounts
                  </text>
                  <For each={limits()?.accounts}>
                    {(account) => (
                      <box flexDirection="row" gap={1}>
                        <text
                          flexShrink={0}
                          fg={
                            account.status === "ok"
                              ? theme.success
                              : account.status === "error" || account.status === "invalid"
                                ? theme.error
                                : theme.warning
                          }
                        >
                          ●
                        </text>
                        <text fg={theme.text}>
                          <b>{account.email.split("@")[0]}</b>
                          <Show when={account.subscription?.tier}>
                            <span style={{ fg: theme.textMuted }}> ({account.subscription?.tier})</span>
                          </Show>
                        </text>
                      </box>
                    )}
                  </For>
                </box>
              </Show>

              <Show when={limits() && limits()!.models.length > 0}>
                <box marginTop={1}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    Model Quotas
                  </text>
                  <For each={limits()?.models.slice(0, 6)}>
                    {(modelId) => {
                      const account = limits()?.accounts[0]
                      const limit = account?.limits[modelId]
                      return (
                        <box flexDirection="row" gap={1}>
                          <text fg={theme.text} width={30}>
                            {modelId}
                          </text>
                          <Show when={limit} fallback={<text fg={theme.textMuted}>-</text>}>
                            <text
                              fg={
                                (limit?.remainingFraction ?? 0) > 0.5
                                  ? theme.success
                                  : (limit?.remainingFraction ?? 0) > 0.2
                                    ? theme.warning
                                    : theme.error
                              }
                            >
                              {limit?.remaining}
                            </text>
                            <Show when={limit?.resetTime && (limit?.remainingFraction ?? 1) < 0.5}>
                              <text fg={theme.textMuted}> (resets in {Antigravity.formatResetTime(limit!.resetTime)})</text>
                            </Show>
                          </Show>
                        </box>
                      )
                    }}
                  </For>
                </box>
              </Show>

              <box marginTop={1}>
                <text fg={theme.textMuted}>
                  WebUI: http://localhost:8080
                </text>
              </box>
            </box>
          </Match>
        </Switch>
      </Show>
    </box>
  )
}
