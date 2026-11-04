import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import type { JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { DialogServer } from "@/servers/connect/dialog"
import { SettingsList } from "@/settings/list"
import type { SettingsServer } from "./inventory"
import "@/settings/settings.css"

/** A per-server page while its server is unreachable. */
export function SettingsServerUnavailable(props: {
  entry: SettingsServer
  title: string
  description: string
  headerAction?: JSX.Element
  /** Opens the Servers page, for servers this page cannot edit. */
  onManage: () => void
  onServerChange: (server: ServerConnection.Any) => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const global = useGlobal()
  const [state, setState] = createStore({ retrying: false })

  const http = () =>
    props.entry.connection?.type === "http" && !ServerConnection.builtin(props.entry.connection)
      ? props.entry.connection
      : undefined

  const retry = () => {
    setState("retrying", true)
    void global.servers.retry().finally(() => setState("retrying", false))
  }

  const edit = () => {
    const server = http()

    if (!server) return props.onManage()
    void dialog.push(() => <DialogServer mode="edit" server={server} onSave={props.onServerChange} />)
  }

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="settings-tab-title">{props.title}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{props.description}</span>
          </div>
          <div class="settings-tab-header-actions">{props.headerAction}</div>
        </div>
      </div>
      <div class="settings-tab-body">
        <SettingsList>
          <div class="settings-server-unavailable" role="status">
            <Icon name="outline-hexagonal-warning" class="settings-server-unavailable-icon" />
            <div class="settings-server-unavailable-title">
              {language.t("settings.server.unreachable.title", { server: props.entry.name })}
            </div>
            <div class="settings-server-unavailable-description">
              {language.t("settings.server.unreachable.description", { server: props.entry.name })}
            </div>
            <div class="settings-server-unavailable-actions">
              <Button
                size="normal"
                variant="neutral"
                icon="refresh"
                disabled={state.retrying}
                onClick={retry}
              >
                {language.t("settings.server.unreachable.retry")}
              </Button>
              <Button size="normal" variant="ghost-muted" onClick={edit}>
                {language.t("settings.server.unreachable.edit")}
              </Button>
            </div>
          </div>
        </SettingsList>
      </div>
    </>
  )
}
