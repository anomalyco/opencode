import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { createSignal, createMemo, Show, type Component } from "solid-js"
import { TextInput } from "@opencode/ui/text-input"
import { ServerRowMenu } from "@/servers/registry/row-menu"
import { ServerHealthIndicator } from "@/servers/registry/row"
import { ExtensionServerRow } from "@/servers/registry/extension-row"
import { AddServerMenu } from "@/servers/registry/add-menu"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName } from "@/runtime/server/registry"
import { useServerCollectionController } from "@/servers/registry/controller"
import { DialogServer } from "@/servers/connect/dialog"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { ShellSetting } from "@/settings/general/general"
import { createServerShellController, createServerVoiceController } from "@/settings/general/controllers"
import type { SettingsServer } from "./inventory"
import "@/settings/settings.css"

export const SettingsServerGeneral: Component<{
  entry: SettingsServer
  nested?: boolean
  onAddServer?: () => void
  onServerChange?: (server: ServerConnection.Any) => void
}> = (props) => {
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
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">
              {props.nested ? props.entry.name : language.t("settings.section.server")}
            </h2>
            <span class="text-11-regular text-v2-text-text-muted">
              {language.t(props.nested ? "settings.server.description" : "settings.servers.description")}
            </span>
          </div>
          <Show when={!props.nested && props.onAddServer}>
            <AddServerMenu onAddServer={() => props.onAddServer?.()} />
          </Show>
        </div>
      </div>

      <div class="settings-tab-body settings-tab-body--sectioned">
        <section class="settings-section settings-server-connection" data-component="settings-server-connection">
          <h3 class="settings-section-title">{language.t("settings.server.section.connection")}</h3>
          <SettingsList>
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
                            {serverName(server()) || props.entry.key}
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
          </SettingsList>
        </section>

        <Show when={props.entry.connection} keyed>
          {(server) => (
            <>
              <ServerShell server={server} />
              <ServerVoice server={server} />
            </>
          )}
        </Show>
      </div>
    </>
  )
}

function ServerShell(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const controller = createServerShellController(() => props.server)

  return (
    <section class="settings-section">
      <h3 class="settings-section-title">{language.t("settings.tab.preferences")}</h3>
      <SettingsList>
        <ShellSetting controller={controller} />
      </SettingsList>
    </section>
  )
}

// The composer sends recordings to this server endpoint; voice ships
// unconfigured, so all fields start empty until a user fills them in.
function ServerVoice(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const controller = createServerVoiceController(() => props.server)

  return (
    <section class="settings-section">
      <h3 class="settings-section-title">{language.t("settings.voice.section.title")}</h3>
      <SettingsList>
        <VoiceSetting
          action="settings-voice-url"
          title={language.t("settings.voice.url.title")}
          description={language.t("settings.voice.url.description")}
          placeholder={language.t("settings.voice.url.placeholder")}
          value={controller.url}
          commit={(value) => controller.save("url", value)}
        />
        <VoiceSetting
          action="settings-voice-api-key"
          title={language.t("settings.voice.apiKey.title")}
          description={language.t("settings.voice.apiKey.description")}
          placeholder={language.t("settings.voice.apiKey.placeholder")}
          value={controller.apiKey}
          secret
          commit={(value) => controller.save("apiKey", value)}
        />
        <VoiceSetting
          action="settings-voice-model"
          title={language.t("settings.voice.model.title")}
          description={language.t("settings.voice.model.description")}
          placeholder={language.t("settings.voice.model.placeholder")}
          value={controller.model}
          commit={(value) => controller.save("model", value)}
        />
      </SettingsList>
    </section>
  )
}

function VoiceSetting(props: {
  action: string
  title: string
  description: string
  placeholder: string
  value: () => string
  secret?: boolean
  commit: (value: string) => void
}) {
  const [draft, setDraft] = createSignal<string>()

  const commit = () => {
    const next = draft()
    setDraft(undefined)

    if (next === undefined || next.trim() === props.value().trim()) return
    props.commit(next)
  }

  return (
    <SettingsRow title={props.title} description={props.description}>
      <div class="w-full sm:w-[280px]">
        <TextInput
          data-action={props.action}
          type={props.secret ? "password" : "text"}
          appearance="base"
          value={draft() ?? props.value()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              commit()
              event.currentTarget.blur()
            }

            if (event.key === "Escape") {
              setDraft(undefined)
              event.currentTarget.blur()
            }
          }}
          placeholder={props.placeholder}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          aria-label={props.title}
        />
      </div>
    </SettingsRow>
  )
}
