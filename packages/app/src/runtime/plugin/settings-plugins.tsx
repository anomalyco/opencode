import { Predicate } from "effect"
import { For, Show } from "solid-js"
import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Switch } from "@opencode/ui/switch"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { SettingsList } from "@/settings/list"
import { showToast } from "@/shell/notifications/toast"
import "@/settings/settings.css"
import { builtins } from "./builtins"
import { usePluginHost } from "./host"
import { createInstalled } from "./installed"
import { useReservedPlugins } from "./root"

/** Every plugin of this desktop window, built-in or from the app's own server, with reload and enable controls. */
export function PluginsSettings() {
  const language = useLanguage()
  const host = usePluginHost()
  const bridge = usePlatform().plugins
  const installed = createInstalled(bridge)
  const reserved = useReservedPlugins()

  const itemOf = (id: string) => installed.list().find((item) => item.id === id)

  // Built-ins always run, so they have no switch.
  const builtin = (id: string) => builtins.some((definition) => definition.id === id)

  const enabled = (id: string) => itemOf(id)?.enabled ?? true

  // Plugins main lists that this window does not load: limited to other systems, or a bundle main could not read.
  const unloaded = () =>
    installed
      .list()
      .filter(
        (item) =>
          item.unsupported ||
          (!item.builtin &&
            item.error !== undefined &&
            !host.definitions().some((definition) => definition.id === item.id)),
      )

  // Why the window entry or main's entry failed; either fails the plugin.
  const errorOf = (id: string) => host.state.failures[id]?.error ?? itemOf(id)?.error

  // The switch already shows whether a plugin runs; only the states it cannot show get a label.
  const status = (id: string) => {
    const value = host.state.status[id] ?? "loading"

    if (value === "failed" || (value === "active" && itemOf(id)?.error))
      return language.t("settings.plugins.status.failed")

    if (value === "active" || value === "disabled") return undefined

    return language.t("settings.plugins.status.loading")
  }

  const run = (work: Promise<void> | undefined) =>
    void work?.catch((cause: unknown) =>
      showToast({
        variant: "error",
        title:
          Predicate.hasProperty(cause, "code") && cause.code === "notFound"
            ? language.t("settings.plugins.error.notFound")
            : language.t("common.requestFailed"),
      }),
    )

  const toggle = (id: string, next: boolean) => run(next ? bridge?.manager.enable(id) : bridge?.manager.disable(id))

  // Main entries reload through the manager; the renderer entry reloads here.
  const reload = (id: string) => {
    host.reload(id)
    run(bridge?.manager.reload(id))
  }

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.plugins.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.plugins.description")}</span>
          </div>
        </div>
      </div>
      <div class="settings-tab-body settings-tab-body--sectioned">
        <section class="settings-section" aria-label={language.t("settings.plugins.title")}>
          {/* The rows of the server Extensions tab, with the Providers tab's badges. */}
          <SettingsList variant="catalog">
            <For each={host.definitions()}>
              {(definition) => (
                <div class="settings-extension-row">
                  <div class="settings-extension-lead">
                    <Icon name="cube" class="text-v2-icon-icon-muted shrink-0" />
                    <div class="flex min-w-0 flex-col gap-0.5">
                      <div class="settings-provider-main">
                        <bdi dir="ltr" class="settings-extension-name truncate">
                          {definition.id}
                        </bdi>
                        <Show when={builtin(definition.id)}>
                          <Badge>{language.t("settings.plugins.builtin")}</Badge>
                        </Show>
                        {/* The parts besides the desktop UI that this row's switch leaves running. */}
                        <Show when={itemOf(definition.id)?.server}>
                          <Badge>{language.t("settings.plugins.part.server")}</Badge>
                        </Show>
                        <Show when={itemOf(definition.id)?.tui}>
                          <Badge>{language.t("settings.plugins.part.tui")}</Badge>
                        </Show>
                        <Show when={status(definition.id)}>
                          {(label) => <span class="text-11-regular text-v2-text-text-muted">{label()}</span>}
                        </Show>
                      </div>
                      <Show when={errorOf(definition.id)}>
                        {(error) => <pre class="settings-server-dialog-error whitespace-pre-wrap">{error()}</pre>}
                      </Show>
                    </div>
                  </div>
                  <div class="settings-servers-actions">
                    <Button size="small" variant="ghost" onClick={() => reload(definition.id)}>
                      {language.t("settings.plugins.reload")}
                    </Button>
                    {/* A built-in keeps the switch's width, so every Reload lines up. */}
                    <Show when={!builtin(definition.id)} fallback={<span class="w-6 shrink-0" aria-hidden="true" />}>
                      <Switch
                        hideLabel
                        checked={enabled(definition.id)}
                        onChange={(next) => toggle(definition.id, next)}
                      >
                        {definition.id}
                      </Switch>
                    </Show>
                  </div>
                </div>
              )}
            </For>
            <For each={unloaded()}>
              {(item) => (
                <div class="settings-extension-row">
                  <div class="settings-extension-lead">
                    <Icon name="cube" class="text-v2-icon-icon-muted shrink-0" />
                    <div class="flex min-w-0 flex-col gap-0.5">
                      <bdi dir="ltr" class="settings-extension-name truncate">
                        {item.id}
                      </bdi>
                      <Show
                        when={item.unsupported}
                        fallback={<pre class="settings-server-dialog-error whitespace-pre-wrap">{item.error}</pre>}
                      >
                        <span class="text-11-regular text-v2-text-text-muted">
                          {language.t("settings.plugins.unsupported")}
                        </span>
                      </Show>
                    </div>
                  </div>
                </div>
              )}
            </For>
            <For each={reserved()}>
              {(id) => (
                <div class="settings-extension-row">
                  <div class="settings-extension-lead">
                    <Icon name="cube" class="text-v2-icon-icon-muted shrink-0" />
                    <div class="flex min-w-0 flex-col gap-0.5">
                      <bdi dir="ltr" class="settings-extension-name truncate">
                        {id}
                      </bdi>
                      <span class="settings-server-dialog-error">{language.t("settings.plugins.reserved")}</span>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </SettingsList>
          <Show when={installed.list().some((item) => !item.builtin)}>
            <p class="text-11-regular text-v2-text-text-muted">{language.t("settings.plugins.parts.note")}</p>
          </Show>
        </section>
      </div>
    </>
  )
}
