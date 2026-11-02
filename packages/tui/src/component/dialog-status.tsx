import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout } from "../ui/dialog"
import { useData } from "../context/data"
import { For, Match, Switch, Show, createMemo, createSignal } from "solid-js"
import { SandboxStatus } from "./sandbox-status"
import { useTerminalDimensions } from "@opentui/solid"

export function DialogStatus() {
  const data = useData()
  const dimensions = useTerminalDimensions()
  const [height, setHeight] = createSignal(1)
  const limit = () => Math.max(1, dimensions().height - Math.floor(dimensions().height / 4) - 6)
  const theme = useTheme().surface("dialog")

  const mcp = createMemo(() => data.location.mcp.server.list() ?? [])
  const color = (status: string) => {
    if (status === "connected") return theme.text.feedback.success.base
    if (status === "failed") return theme.text.feedback.error.base
    if (status === "needs_auth") return theme.text.feedback.warning.base
    return theme.text.muted
  }
  return (
    <DialogLayout header={<DialogHeader title="Status" />}>
      <scrollbox id="status.body" height={Math.min(height(), limit())}>
        <box
          flexShrink={0}
          gap={1}
          onSizeChange={function () {
            setHeight(this.height)
          }}
        >
          <SandboxStatus />
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
      </scrollbox>
    </DialogLayout>
  )
}
