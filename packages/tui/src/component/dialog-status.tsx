import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useData } from "../context/data"
import { For, Match, Switch, Show, createMemo } from "solid-js"

export function DialogStatus() {
  const data = useData()
  const theme = useTheme().surface("dialog")
  const dialog = useDialog()

  const mcp = createMemo(() => data.location.mcp.server.list() ?? [])
  const color = (status: string) => {
    if (status === "connected") return theme.text.feedback.success.base
    if (status === "failed") return theme.text.feedback.error.base
    if (status === "needs_auth") return theme.text.feedback.warning.base
    return theme.text.muted
  }
  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
          MCP status
        </text>
        <text fg={theme.text.muted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={mcp().length > 0} fallback={<text fg={theme.text.base}>No MCP servers</text>}>
        <box>
          <text fg={theme.text.base}>
            {mcp().length} MCP server{mcp().length === 1 ? "" : "s"}
          </text>
          <For each={mcp()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} style={{ fg: color(item.status.status) }}>
                  •
                </text>
                <text fg={theme.text.base} wrapMode="word">
                  <b>{item.name}</b>{" "}
                  <span style={{ fg: theme.text.muted }}>
                    <Switch fallback={item.status.status}>
                      <Match when={item.status.status === "connected"}>Connected</Match>
                      <Match when={item.status.status === "failed" && item.status}>{(val) => val().error}</Match>
                      <Match when={item.status.status === "disabled"}>Disabled in configuration</Match>
                      <Match when={item.status.status === "needs_auth" && item.status}>
                        {(val) => `Needs authentication: ${val().error}`}
                      </Match>
                    </Switch>
                  </span>
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}
