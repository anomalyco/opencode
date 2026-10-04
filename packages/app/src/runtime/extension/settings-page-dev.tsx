import { For, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Switch } from "@opencode/ui/switch"
import type { Installed } from "@opencode/gui-extensions/sdk/bridge"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { useExtensionHost } from "./host"

/** Development builds: every built-in GUI extension of this window, with enable and reload controls. */
export function GuiExtensionsSettings() {
  const language = useLanguage()
  const host = useExtensionHost()
  const bridge = usePlatform().extensions
  const [installed, setInstalled] = createStore<{ list: Installed[] }>({ list: [] })

  if (bridge) {
    void bridge.manager.list().then((list) => setInstalled("list", reconcile([...list])))
    onCleanup(
      bridge.on((message) => {
        if (message.type === "extensions") setInstalled("list", reconcile([...message.list]))
      }),
    )
  }

  const enabled = (id: string) => installed.list.find((item) => item.id === id)?.enabled ?? true

  const status = (id: string) => {
    const value = host.state.status[id] ?? "loading"

    if (value === "active") return language.t("settings.guiExtensions.status.active")

    if (value === "failed") return language.t("settings.guiExtensions.status.failed")

    if (value === "disabled") return language.t("settings.guiExtensions.status.disabled")

    return language.t("settings.guiExtensions.status.loading")
  }

  const toggle = (id: string, next: boolean) => void (next ? bridge?.manager.enable(id) : bridge?.manager.disable(id))

  // Main entries reload through the manager; the renderer entry reloads here.
  const reload = (id: string) => {
    host.reload(id)
    void bridge?.manager.reload(id)
  }

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.guiExtensions.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">
              {language.t("settings.guiExtensions.description")}
            </span>
          </div>
        </div>
      </div>
      <div class="settings-tab-body settings-tab-body--sectioned">
        <section class="settings-section" aria-label={language.t("settings.guiExtensions.title")}>
          <SettingsList>
            <For each={host.definitions()}>
              {(definition) => (
                <SettingsRow
                  title={<bdi dir="ltr">{definition.id}</bdi>}
                  description={
                    <>
                      {status(definition.id)}
                      <Show when={host.state.failures[definition.id]?.error}>
                        {(error) => <pre class="mt-1 whitespace-pre-wrap text-text-danger-base">{error()}</pre>}
                      </Show>
                    </>
                  }
                >
                  <div class="flex items-center gap-3">
                    <Button size="small" variant="ghost" onClick={() => reload(definition.id)}>
                      {language.t("settings.guiExtensions.reload")}
                    </Button>
                    <Switch hideLabel checked={enabled(definition.id)} onChange={(next) => toggle(definition.id, next)}>
                      {definition.id}
                    </Switch>
                  </div>
                </SettingsRow>
              )}
            </For>
          </SettingsList>
        </section>
      </div>
    </>
  )
}
