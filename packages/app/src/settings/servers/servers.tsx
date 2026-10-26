import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { createMemo, For, Show, type Component } from "solid-js"
import { ServerRowMenu } from "@/servers/registry/row-menu"
import { ServerHealthIndicator } from "@/servers/registry/row"
import { ExtensionServerRow } from "@/servers/registry/extension-row"
import { AddServerMenu } from "@/servers/registry/add-menu"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useServerCollectionController } from "@/servers/registry/controller"
import { DialogServer } from "@/servers/connect/dialog"
import { SettingsList } from "@/settings/list"
import { ShellSetting } from "@/settings/general/general"
import { createServerShellController } from "@/settings/general/controllers"
import type { SettingsServer } from "./inventory"
import "@/settings/settings.css"

/** The only server's connection and preferences. */
export const SettingsServerGeneral: Component<{ entry: SettingsServer; onAddServer: () => void }> = (props) => {
  const language = useLanguage()
  const controller = useServerCollectionController()
  const health = createMemo(() => controller.collection.health()[props.entry.key])

  return (
    <>
      <SettingsServersHeader title={language.t("settings.section.server")} onAddServer={props.onAddServer} />

      <div class="settings-tab-body settings-tab-body--sectioned">
        <section class="settings-section settings-server-connection" data-component="settings-server-connection">
          <h3 class="settings-section-title">{language.t("settings.server.section.connection")}</h3>
          <SettingsList>
            <ServerConnectionRow entry={props.entry} />
          </SettingsList>
        </section>

        <Show when={props.entry.connection && health()?.healthy !== false ? props.entry.connection : undefined} keyed>
          {(server) => (
            <section class="settings-section">
              <h3 class="settings-section-title">{language.t("settings.tab.preferences")}</h3>
              <SettingsList>
                <ServerShell server={server} />
              </SettingsList>
            </section>
          )}
        </Show>
      </div>
    </>
  )
}

/** Every server, each with its connection and terminal shell. */
export const SettingsServerList: Component<{
  servers: readonly SettingsServer[]
  /** The server whose shell row search results reveal. */
  selected?: string
  onAddServer: () => void
  onServerChange: (server: ServerConnection.Any) => void
}> = (props) => {
  const language = useLanguage()
  const controller = useServerCollectionController()

  return (
    <>
      <SettingsServersHeader title={language.t("settings.tab.servers")} onAddServer={props.onAddServer} />

      <div class="settings-tab-body settings-tab-body--sectioned">
        <For each={props.servers}>
          {(entry) => (
            <section
              class="settings-section settings-server-connection"
              data-component="settings-server-connection"
              aria-label={entry.name}
            >
              <SettingsList>
                <ServerConnectionRow entry={entry} onServerChange={props.onServerChange} />
                <Show
                  when={
                    entry.connection && controller.collection.health()[entry.key]?.healthy !== false
                      ? entry.connection
                      : undefined
                  }
                  keyed
                >
                  {(server) => (
                    <ServerShell
                      server={server}
                      action={entry.key === props.selected ? undefined : `settings-shell:${entry.key}`}
                    />
                  )}
                </Show>
              </SettingsList>
            </section>
          )}
        </For>
      </div>
    </>
  )
}

function SettingsServersHeader(props: { title: string; onAddServer: () => void }) {
  const language = useLanguage()

  return (
    <div class="settings-tab-header">
      <div class="settings-tab-header-row">
        <div class="flex min-w-0 flex-col gap-1">
          <h2 class="settings-tab-title">{props.title}</h2>
          <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.servers.description")}</span>
        </div>
        <div class="settings-tab-header-actions">
          <AddServerMenu onAddServer={props.onAddServer} />
        </div>
      </div>
    </div>
  )
}

function ServerConnectionRow(props: { entry: SettingsServer; onServerChange?: (server: ServerConnection.Any) => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const controller = useServerCollectionController()
  const health = createMemo(() => controller.collection.health()[props.entry.key])

  const edit = (server: ServerConnection.Http) =>
    void dialog.push(() => <DialogServer mode="edit" server={server} onSave={props.onServerChange} />)

  // An HTTP server that rejects its saved credentials signs in again through the edit dialog.
  const signedOut = (server: ServerConnection.Any) =>
    server.type === "http" && health()?.unauthorized ? server : undefined

  return (
    <Show
      when={props.entry.source?.entry.row ? props.entry.key : undefined}
      keyed
      fallback={
        <Show when={props.entry.connection}>
          {(server) => (
            <div class="settings-servers-row">
              <div class="settings-servers-lead">
                <ServerHealthIndicator health={health()} authenticationRequired={!!health()?.unauthorized} />
                <div class="settings-servers-copy">
                  <bdi class="settings-servers-name" dir="auto">
                    {props.entry.name}
                  </bdi>
                  <bdi class="settings-servers-meta" dir="ltr">
                    {server().http.url}
                  </bdi>
                </div>
              </div>
              <div class="settings-servers-actions">
                <Show when={signedOut(server())}>
                  {(http) => (
                    <Button size="small" variant="neutral" onClick={() => edit(http())}>
                      {language.t("server.action.authenticate")}
                    </Button>
                  )}
                </Show>
                <ServerRowMenu server={server()} domain={controller} onEdit={edit} />
              </div>
            </div>
          )}
        </Show>
      }
    >
      {(key) => <ExtensionServerRow server={key} controller={controller} />}
    </Show>
  )
}

function ServerShell(props: { server: ServerConnection.Any; action?: string }) {
  const controller = createServerShellController(() => props.server)

  return <ShellSetting controller={controller} action={props.action} />
}
