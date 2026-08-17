import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useData } from "../context/data"
import { For, Match, Switch, Show, createMemo } from "solid-js"

export type DialogStatusProps = {}

export function DialogStatus() {
  const data = useData()
  const { themeV2 } = useTheme().contextual("elevated")
  const dialog = useDialog()

  const mcp = createMemo(() => data.location.mcp.server.list() ?? [])
  const color = (status: string) => {
    if (status === "connected") return themeV2.text.feedback.success()
    if (status === "failed") return themeV2.text.feedback.error()
    if (status === "needs_auth") return themeV2.text.feedback.warning()
    if (status === "needs_client_registration") return themeV2.text.feedback.error()
    return themeV2.text.subdued()
  }
  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={themeV2.text()} attributes={TextAttributes.BOLD}>
          Status
        </text>
        <text fg={themeV2.text.subdued()} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={mcp().length > 0} fallback={<text fg={themeV2.text()}>No MCP servers</text>}>
        <box>
          <text fg={themeV2.text()}>
            {mcp().length} MCP server{mcp().length === 1 ? "" : "s"}
          </text>
          <For each={mcp()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} style={{ fg: color(item.status.status) }}>
                  •
                </text>
                <text fg={themeV2.text()} wrapMode="word">
                  <b>{item.name}</b>{" "}
                  <span style={{ fg: themeV2.text.subdued() }}>
                    <Switch fallback={item.status.status}>
                      <Match when={item.status.status === "connected"}>Connected</Match>
                      <Match when={item.status.status === "failed" && item.status}>{(val) => val().error}</Match>
                      <Match when={item.status.status === "disabled"}>Disabled in configuration</Match>
                      <Match when={item.status.status === "needs_auth"}>Needs authentication</Match>
                      <Match when={item.status.status === "needs_client_registration" && item.status}>
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
    </box>
  )
}
