import { useLanguage } from "../context/language"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useData } from "../context/data"
import { For, Match, Switch, Show, createMemo } from "solid-js"

export function DialogStatus() {
  const data = useData()
  const language = useLanguage()
  const theme = useTheme("elevated")
  const dialog = useDialog()

  const mcp = createMemo(() => data.location.mcp.server.list() ?? [])
  const color = (status: string) => {
    if (status === "connected") return theme.text.feedback.success.default
    if (status === "failed") return theme.text.feedback.error.default
    if (status === "needs_auth") return theme.text.feedback.warning.default
    return theme.text.subdued
  }
  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.default} attributes={TextAttributes.BOLD}>
          Status
        </text>
        <text fg={theme.text.subdued} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show
        when={mcp().length > 0}
        fallback={<text fg={theme.text.default}>{language.t("tui.details.noMCPServers")}</text>}
      >
        <box>
          <text fg={theme.text.default}>
            {mcp().length} MCP server{mcp().length === 1 ? "" : "s"}
          </text>
          <For each={mcp()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} style={{ fg: color(item.status.status) }}>
                  •
                </text>
                <text fg={theme.text.default} wrapMode="word">
                  <b>{item.name}</b>{" "}
                  <span style={{ fg: theme.text.subdued }}>
                    <Switch fallback={item.status.status}>
                      <Match when={item.status.status === "connected"}>{language.t("tui.details.connected")}</Match>
                      <Match when={item.status.status === "failed" && item.status}>{(val) => val().error}</Match>
                      <Match when={item.status.status === "disabled"}>
                        {language.t("tui.details.disabledInConfiguration")}
                      </Match>
                      <Match when={item.status.status === "needs_auth"}>
                        {language.t("tui.details.needsAuthentication")}
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
