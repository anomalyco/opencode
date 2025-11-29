import { createMemo, Match, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const mcp = createMemo(() => Object.keys(sync.data.mcp))
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const directory = useDirectory()
  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <text fg={theme.textMuted}>{directory()}</text>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <text fg={theme.text}>
          <span style={{ fg: theme.success }}>•</span> {lsp().length} LSP
        </text>
        <Show when={mcp().length}>
          <text fg={theme.text}>
            <Switch>
              <Match when={mcpError()}>
                <span style={{ fg: theme.error }}>⊙ </span>
              </Match>
              <Match when={true}>
                <span style={{ fg: theme.success }}>⊙ </span>
              </Match>
            </Switch>
            {mcp().length} MCP
          </text>
        </Show>
        <text fg={theme.textMuted}>/status</text>
      </box>
    </box>
  )
}
