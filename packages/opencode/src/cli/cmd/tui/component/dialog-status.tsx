import { TextAttributes } from "@opentui/core"
import { fileURLToPath } from "bun"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { For, Match, Switch, Show, createMemo, createSignal } from "solid-js"
import { Installation } from "@/installation"

export type DialogStatusProps = {}

function formatResetTime(resetAt: number): string {
  const diff = resetAt - Date.now()
  if (diff <= 0) return "now"
  const hours = Math.floor(diff / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)
  if (hours > 24) return `${Math.floor(hours / 24)}d`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function usageBar(usedPercent: number, width = 10): string {
  const remaining = 100 - usedPercent
  const filled = Math.round((remaining / 100) * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

export function DialogStatus() {
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()
  const [hover, setHover] = createSignal(false)

  const enabledFormatters = createMemo(() => sync.data.formatter.filter((f) => f.enabled))

  const codexAccounts = createMemo(() => sync.data.codex_usage?.accounts ?? [])

  const plugins = createMemo(() => {
    const list = sync.data.config.plugin ?? []
    const result = list.map((value) => {
      if (value.startsWith("file://")) {
        const path = fileURLToPath(value)
        const parts = path.split("/")
        const filename = parts.pop() || path
        if (!filename.includes(".")) return { name: filename }
        const basename = filename.split(".")[0]
        if (basename === "index") {
          const dirname = parts.pop()
          const name = dirname || basename
          return { name }
        }
        return { name: basename }
      }
      const index = value.lastIndexOf("@")
      if (index <= 0) return { name: value, version: "latest" }
      const name = value.substring(0, index)
      const version = value.substring(index + 1)
      return { name, version }
    })
    return result.toSorted((a, b) => a.name.localeCompare(b.name))
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Status
        </text>
        <box
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={hover() ? theme.primary : undefined}
          onMouseOver={() => setHover(true)}
          onMouseOut={() => setHover(false)}
          onMouseUp={() => dialog.clear()}
        >
          <text fg={hover() ? theme.selectedListItemText : theme.textMuted}>esc</text>
        </box>
      </box>
      <text fg={theme.textMuted}>OpenCode v{Installation.VERSION}</text>
      <Show when={codexAccounts().length > 0}>
        <box>
          <text fg={theme.text}>{codexAccounts().length} Codex Accounts</text>
          <For each={codexAccounts()}>
            {(account) => {
              const isRateLimited = account.usage?.primary && account.usage.primary.usedPercent >= 100
              return (
                <box>
                  <box flexDirection="row" gap={1}>
                    <text
                      flexShrink={0}
                      style={{
                        fg: account.isActive ? theme.success : theme.textMuted,
                      }}
                    >
                      {account.isActive ? "●" : "•"}
                    </text>
                    <text fg={theme.text} wrapMode="word">
                      <b>{account.email}</b>{" "}
                      <span style={{ fg: theme.textMuted }}>
                        {account.usage?.planType ?? "unknown"}
                        {isRateLimited && <span style={{ fg: theme.warning }}> [rate limited]</span>}
                      </span>
                    </text>
                  </box>
                  <Show when={account.usage?.primary}>
                    {(primary) => {
                      const remaining = 100 - primary().usedPercent
                      return (
                        <text fg={theme.textMuted}>
                          {"  "}5h: [{usageBar(primary().usedPercent)}] {remaining}% left, resets in{" "}
                          {formatResetTime(primary().resetAt)}
                        </text>
                      )
                    }}
                  </Show>
                  <Show when={account.usage?.secondary}>
                    {(secondary) => {
                      const remaining = 100 - secondary().usedPercent
                      return (
                        <text fg={theme.textMuted}>
                          {"  "}Weekly: [{usageBar(secondary().usedPercent)}] {remaining}% left, resets in{" "}
                          {formatResetTime(secondary().resetAt)}
                        </text>
                      )
                    }}
                  </Show>
                  <Show when={account.error}>
                    <text fg={theme.error}>{"  "}Error: {account.error}</text>
                  </Show>
                </box>
              )
            }}
          </For>
        </box>
      </Show>
      <Show when={Object.keys(sync.data.mcp).length > 0} fallback={<text fg={theme.text}>No MCP Servers</text>}>
        <box>
          <text fg={theme.text}>{Object.keys(sync.data.mcp).length} MCP Servers</text>
          <For each={Object.entries(sync.data.mcp)}>
            {([key, item]) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: (
                      {
                        connected: theme.success,
                        failed: theme.error,
                        disabled: theme.textMuted,
                        needs_auth: theme.warning,
                        needs_client_registration: theme.error,
                      } as Record<string, typeof theme.success>
                    )[item.status],
                  }}
                >
                  •
                </text>
                <text fg={theme.text} wrapMode="word">
                  <b>{key}</b>{" "}
                  <span style={{ fg: theme.textMuted }}>
                    <Switch fallback={item.status}>
                      <Match when={item.status === "connected"}>Connected</Match>
                      <Match when={item.status === "failed" && item}>{(val) => val().error}</Match>
                      <Match when={item.status === "disabled"}>Disabled in configuration</Match>
                      <Match when={(item.status as string) === "needs_auth"}>
                        Needs authentication (run: opencode mcp auth {key})
                      </Match>
                      <Match when={(item.status as string) === "needs_client_registration" && item}>
                        {(val) => (val() as { error: string }).error}
                      </Match>
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
      <Show when={plugins().length > 0} fallback={<text fg={theme.text}>No Plugins</text>}>
        <box>
          <text fg={theme.text}>{plugins().length} Plugins</text>
          <For each={plugins()}>
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
                  {item.version && <span style={{ fg: theme.textMuted }}> @{item.version}</span>}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}
