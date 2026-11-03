import type { PluginInfo } from "@opencode/client"
import { Predicate } from "effect"
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js"
import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Switch } from "@opencode/ui/switch"
import { pluginLabel } from "@/providers/catalog/plugin"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { SettingsList } from "@/settings/list"
import { showToast } from "@/shell/notifications/toast"
import "@/settings/settings.css"
import { builtins } from "./builtins"
import { usePluginHost } from "./host"
import { createInstalled } from "./installed"
import { useReservedPlugins } from "./root"

/**
 * The plugins a server lists, for the Plugins tab of Extensions. Only the desktop app's own server (`own`) runs its
 * plugins' GUIs in this window, so only its rows add the window's controls; other servers and the web list names.
 */
export function ExtensionPlugins(props: { plugins: readonly PluginInfo[]; own: boolean }) {
  const listed = () => props.plugins.filter((plugin) => plugin.source.type !== "builtin")

  return (
    <Show
      when={props.own}
      fallback={
        <SettingsList variant="catalog">
          <For each={listed()}>
            {(plugin) => (
              <div class="settings-extension-row">
                <div class="settings-extension-lead">
                  <Icon name="cube" class="text-v2-icon-icon-muted shrink-0" />
                  <span class="settings-extension-name truncate">{pluginLabel(plugin)}</span>
                </div>
              </div>
            )}
          </For>
        </SettingsList>
      }
    >
      <OwnServerPlugins plugins={listed()} />
    </Show>
  )
}

/**
 * The plugins of the desktop app's own server, merged by id with what main and this window know of their GUIs: a
 * switch that turns off only the desktop UI, Reload, status and errors, and rows for plugins main lists that the
 * server list does not name. Built-ins always run and stay hidden unless they failed, which only this list reports.
 */
function OwnServerPlugins(props: { plugins: readonly PluginInfo[] }) {
  const language = useLanguage()
  const host = usePluginHost()
  const bridge = usePlatform().plugins
  const installed = createInstalled(bridge)
  const reserved = useReservedPlugins()

  const builtin = (id: string) => builtins.some((definition) => definition.id === id)

  // A server plugin's id can be a built-in's (a reserved id), so each row looks up its own kind of item.
  const itemOf = (id: string, kind: "builtin" | "config") =>
    installed.list().find((item) => item.id === id && item.builtin === (kind === "builtin"))

  const defined = (id: string) => !builtin(id) && host.definitions().some((definition) => definition.id === id)

  // What the window knows of a plugin on this server. A plugin without a GUI has nothing besides its name.
  const kind = (id: string | undefined) => {
    if (!id) return undefined

    if (reserved().includes(id)) return "reserved"
    const item = itemOf(id, "config")

    if (item?.unsupported) return "unsupported"

    // A bundle main could not read never reaches the window.
    if (item?.error !== undefined && !defined(id)) return "unreadable"

    if (item || defined(id)) return "loaded"

    return undefined
  }

  // Plugins main reports that the server list does not name, for example while that list loads or after it failed.
  const unnamed = createMemo(() => {
    const named = new Set(props.plugins.flatMap((plugin) => (plugin.id ? [plugin.id] : [])))

    return [
      ...new Set([
        ...host.definitions().flatMap((definition) => (builtin(definition.id) ? [] : [definition.id])),
        ...installed.list().flatMap((item) => (item.builtin ? [] : [item.id])),
        ...reserved(),
      ]),
    ].filter((id) => !named.has(id))
  })

  // Why the window entry or main's entry failed; either fails the plugin.
  const errorOf = (id: string, kind: "builtin" | "config") => host.state.failures[id]?.error ?? itemOf(id, kind)?.error

  const failedBuiltins = createMemo(() =>
    host
      .definitions()
      .flatMap((definition) =>
        builtin(definition.id) && errorOf(definition.id, "builtin") !== undefined ? [definition.id] : [],
      ),
  )

  // The switch already shows whether a plugin runs; only the states it cannot show get a label.
  const status = (id: string, kind: "builtin" | "config") => {
    const value = host.state.status[id] ?? "loading"

    if (value === "failed" || (value === "active" && itemOf(id, kind)?.error))
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

  const row = (input: { id: string | undefined; name: string; builtin?: boolean }) => {
    const state = () => (input.builtin ? "loaded" : kind(input.id))
    const part = input.builtin ? "builtin" : "config"
    const live = () => (state() === "loaded" ? input.id : undefined)

    return (
      <div class="settings-extension-row">
        <div class="settings-extension-lead">
          <Icon name="cube" class="text-v2-icon-icon-muted shrink-0" />
          <div class="flex min-w-0 flex-col gap-0.5">
            <div class="settings-provider-main">
              <bdi dir="ltr" class="settings-extension-name truncate">
                {input.name}
              </bdi>
              <Show when={live()}>
                {(id) => (
                  <>
                    <Show when={input.builtin}>
                      <Badge>{language.t("settings.plugins.builtin")}</Badge>
                    </Show>
                    {/* The parts besides the desktop UI that this row's switch leaves running. */}
                    <Show when={itemOf(id(), part)?.server}>
                      <Badge>{language.t("settings.plugins.part.server")}</Badge>
                    </Show>
                    <Show when={itemOf(id(), part)?.tui}>
                      <Badge>{language.t("settings.plugins.part.tui")}</Badge>
                    </Show>
                    <Show when={status(id(), part)}>
                      {(label) => <span class="text-11-regular text-v2-text-text-muted">{label()}</span>}
                    </Show>
                  </>
                )}
              </Show>
            </div>
            <Show when={live()}>
              {(id) => <Show when={errorOf(id(), part)}>{(error) => <PluginError error={error()} />}</Show>}
            </Show>
            <Show when={state() === "unsupported"}>
              <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.plugins.unsupported")}</span>
            </Show>
            <Show when={state() === "unreadable" && input.id && itemOf(input.id, part)?.error}>
              {(error) => <PluginError error={error()} />}
            </Show>
            <Show when={state() === "reserved"}>
              <span class="settings-server-dialog-error">{language.t("settings.plugins.reserved")}</span>
            </Show>
          </div>
        </div>
        <Show when={live()}>
          {(id) => (
            <div class="settings-servers-actions">
              <Button size="small" variant="ghost" onClick={() => reload(id())}>
                {language.t("settings.plugins.reload")}
              </Button>
              {/* A built-in always runs; it keeps the switch's width, so every Reload lines up. */}
              <Show when={!input.builtin} fallback={<span class="w-6 shrink-0" aria-hidden="true" />}>
                <Switch hideLabel checked={itemOf(id(), part)?.enabled ?? true} onChange={(next) => toggle(id(), next)}>
                  {id()}
                </Switch>
              </Show>
            </div>
          )}
        </Show>
      </div>
    )
  }

  return (
    <>
      <SettingsList variant="catalog">
        <For each={props.plugins}>{(plugin) => row({ id: plugin.id, name: pluginLabel(plugin) })}</For>
        <For each={unnamed()}>{(id) => row({ id, name: id })}</For>
        <For each={failedBuiltins()}>{(id) => row({ id, name: id, builtin: true })}</For>
      </SettingsList>
      <Show when={installed.list().some((item) => !item.builtin)}>
        <p class="text-11-regular text-v2-text-text-muted">{language.t("settings.plugins.parts.note")}</p>
      </Show>
    </>
  )
}

/** A plugin's error: its first line, the message, with the rest (such as a stack trace) behind a toggle. */
function PluginError(props: { error: string }) {
  const language = useLanguage()
  const id = createUniqueId()
  const [open, setOpen] = createSignal(false)
  const message = () => props.error.split("\n", 1)[0]
  const more = () => props.error.trimEnd().includes("\n")

  return (
    <div class="flex min-w-0 flex-col items-start gap-1">
      <pre id={id} class="settings-server-dialog-error whitespace-pre-wrap">
        {open() || !more() ? props.error : message()}
      </pre>
      <Show when={more()}>
        <Button
          size="small"
          variant="ghost-muted"
          class="settings-plugin-error-toggle"
          aria-expanded={open()}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
        >
          {language.t(open() ? "settings.plugins.error.hide" : "settings.plugins.error.show")}
        </Button>
      </Show>
    </div>
  )
}
