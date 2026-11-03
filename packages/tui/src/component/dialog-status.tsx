import { useLanguage } from "../context/language"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout } from "../ui/dialog"
import { useData } from "../context/data"
import { For, Match, Switch, Show, createMemo } from "solid-js"

export function DialogStatus() {
  const data = useData()
  const language = useLanguage()
  const theme = useTheme().surface("dialog")

  const mcp = createMemo(() => data.location.mcp.server.list() ?? [])
  const color = (status: string) => {
    if (status === "connected") return theme.text.feedback.success.base
    if (status === "failed") return theme.text.feedback.error.base
    if (status === "needs_auth") return theme.text.feedback.warning.base
    return theme.text.muted
  }
  return (
    <DialogLayout header={<DialogHeader title={language.t("tui.devtools.status")} />}>
      <Show
        when={mcp().length > 0}
        fallback={<text fg={theme.text.base}>{language.t("tui.details.noMCPServers")}</text>}
      >
        <box>
          <text fg={theme.text.base}>{language.plural("tui.dialogs.mcpCount", mcp().length)}</text>
          <For each={mcp()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} style={{ fg: color(item.status.status) }}>
                  •
                </text>
                <text fg={theme.text.base} wrapMode="word">
                  <b>{item.name}</b>{" "}
                  <span style={{ fg: theme.text.muted }}>
                    <Switch fallback={language.t("tui.devtools.connecting")}>
                      <Match when={item.status.status === "connected"}>{language.t("tui.details.connected")}</Match>
                      <Match when={item.status.status === "failed" && item.status}>{(val) => val().error}</Match>
                      <Match when={item.status.status === "disabled"}>
                        {language.t("tui.details.disabledInConfiguration")}
                      </Match>
                      <Match when={item.status.status === "needs_auth" && item.status}>
                        {(val) => `${language.t("tui.details.needsAuthentication")}: ${val().error}`}
                      </Match>
                    </Switch>
                  </span>
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
    </DialogLayout>
  )
}
