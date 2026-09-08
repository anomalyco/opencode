import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { Badge } from "@opencode/ui/badge"
import { Button } from "@opencode/ui/button"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { SettingsRow } from "@opencode/ui/layout"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { ExtensionManager } from "@opencode/plugin/desktop/manager"
import { useDesktopExtensions } from "@/extensions/provider"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import "./extensions.css"

const errors = {
  invalidArchive: "settings.desktopExtensions.error.archive",
  invalidManifest: "settings.desktopExtensions.error.manifest",
  invalidPath: "settings.desktopExtensions.error.path",
  tooLarge: "settings.desktopExtensions.error.size",
  reserved: "settings.desktopExtensions.error.reserved",
  notFound: "settings.desktopExtensions.error.notFound",
  disabled: "settings.desktopExtensions.error.disabled",
  invalidModule: "settings.desktopExtensions.error.module",
  download: "settings.desktopExtensions.error.download",
  url: "settings.desktopExtensions.error.url",
  storage: "settings.desktopExtensions.error.storage",
  files: "settings.desktopExtensions.error.files",
} as const

/** Port of OCDX's manager, backed by the native Desktop extension registry. */
export function SettingsExtensions() {
  const host = useDesktopExtensions()
  const language = useLanguage()
  const platform = usePlatform()
  const [state, setState] = createStore({
    url: "",
    busy: false,
    dragging: false,
    error: undefined as keyof typeof errors | undefined,
  })
  let picker: HTMLInputElement | undefined
  const entries = createMemo(() =>
    [
      ...host.builtins().map((plugin) => ({
        id: plugin.id,
        name: plugin.name ? (language.t(plugin.name as Parameters<typeof language.t>[0]) ?? plugin.name) : plugin.id,
        version: plugin.version ?? platform.version ?? "0.0.0",
        enabled: true,
        builtin: true,
        hasMain: plugin.main ?? false,
      })),
      ...host.state.installed
        .filter((entry) => !host.builtins().some((plugin) => plugin.id === entry.id))
        .map((entry) => ({ ...entry, builtin: false })),
    ].toSorted((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name)),
  )
  const error = () => state.error ?? host.state.managerError
  const failed = () => host.state.installed.find((entry) => host.state.failures[entry.id])
  const perform = async (action: (manager: ExtensionManager.Transport) => Promise<unknown>) => {
    if (state.busy || !host.manager) return false
    setState({ busy: true, error: undefined })
    try {
      await action(host.manager)
      return true
    } catch (error) {
      setState("error", error instanceof ExtensionManager.ManagerError ? error.code : "storage")
      return false
    } finally {
      setState("busy", false)
    }
  }
  const installFiles = async (files: FileList | File[]) => {
    const archives = Array.from(files).filter((file) => file.name.toLowerCase().endsWith(".ocdx"))
    if (!archives.length) {
      setState("error", "files")
      return
    }
    await perform(async (manager) => {
      for (const file of archives) await manager.install(new Uint8Array(await file.arrayBuffer()))
    })
  }
  const installURL = async () => {
    const url = state.url.trim()
    if (!url) return
    if (await perform((manager) => manager.installURL(url))) setState("url", "")
  }
  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <h2 class="settings-tab-title">{language.t("settings.tab.extensions")}</h2>
        </div>
      </div>
      <div class="settings-tab-body desktop-extension-manager" data-component="desktop-extension-manager">
        <section class="settings-section desktop-extension-install">
          <h3 class="settings-section-title">{language.t("settings.desktopExtensions.installTitle")}</h3>
          <div
            class="desktop-extension-drop"
            data-dragging={state.dragging}
            onDragEnter={(event) => {
              event.preventDefault()
              setState("dragging", true)
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
              setState("dragging", false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              setState("dragging", false)
              if (event.dataTransfer) void installFiles(event.dataTransfer.files)
            }}
          >
            <div>
              <strong>{language.t("settings.desktopExtensions.drop")}</strong>
              <span>{language.t("settings.desktopExtensions.choose")}</span>
            </div>
            <Button size="small" variant="neutral" disabled={state.busy} onClick={() => picker?.click()}>
              {language.t("settings.desktopExtensions.browse")}
            </Button>
            <input
              ref={picker}
              type="file"
              accept=".ocdx"
              multiple
              hidden
              aria-label={language.t("settings.desktopExtensions.files")}
              onChange={(event) => {
                if (event.currentTarget.files) void installFiles(event.currentTarget.files)
                event.currentTarget.value = ""
              }}
            />
          </div>
          <div class="desktop-extension-method-label">{language.t("settings.desktopExtensions.fromURL")}</div>
          <div class="desktop-extension-url">
            <TextInput
              appearance="large"
              dir="ltr"
              value={state.url}
              placeholder={language.t("settings.desktopExtensions.placeholder")}
              aria-label={language.t("settings.desktopExtensions.url")}
              disabled={state.busy}
              onInput={(event) => setState("url", event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void installURL()
              }}
            />
            <Button
              size="normal"
              variant="neutral"
              disabled={state.busy || !state.url.trim()}
              onClick={() => void installURL()}
            >
              {language.t("settings.desktopExtensions.install")}
            </Button>
          </div>
        </section>
        <Show when={error()}>
          {(error) => (
            <div role="alert" class="desktop-extension-error">
              {language.t(errors[error()])}
            </div>
          )}
        </Show>
        <Show when={failed()}>
          {(entry) => (
            <div role="alert" class="desktop-extension-error">
              {language.t("settings.desktopExtensions.error.activation", { name: entry().name })}
            </div>
          )}
        </Show>
        <section class="settings-section">
          <h3 class="settings-section-title">{language.t("settings.desktopExtensions.installed")}</h3>
          <div data-component="settings-list">
            <Show
              when={host.state.managerReady}
              fallback={
                <div role="status" class="desktop-extension-empty">
                  {language.t("common.loading")}
                </div>
              }
            >
              <Show
                when={entries().length}
                fallback={<div class="desktop-extension-empty">{language.t("settings.desktopExtensions.empty")}</div>}
              >
                <For each={entries()}>
                  {(entry) => (
                    <SettingsRow
                      title={
                        <span class="desktop-extension-title">
                          <bdi dir="auto">{entry.name}</bdi>
                          <Badge variant="neutral">v{entry.version}</Badge>
                          <Show when={entry.builtin}>
                            <Badge variant="accent">{language.t("settings.desktopExtensions.builtin")}</Badge>
                          </Show>
                          <Show when={entry.hasMain}>
                            <Badge variant="neutral">{language.t("settings.desktopExtensions.main")}</Badge>
                          </Show>
                        </span>
                      }
                      description={<bdi dir="ltr">{entry.id}</bdi>}
                    >
                      <div class="flex items-center gap-3">
                        <Show when={!entry.builtin}>
                          <Tooltip value={language.t("settings.desktopExtensions.reload", { name: entry.name })}>
                            <IconButton
                              icon={<Icon name="reset" />}
                              variant="ghost-muted"
                              size="normal"
                              disabled={state.busy || !entry.enabled}
                              aria-label={language.t("settings.desktopExtensions.reload", { name: entry.name })}
                              onClick={() => void perform((manager) => manager.reload(entry.id))}
                            />
                          </Tooltip>
                        </Show>
                        <Switch
                          checked={entry.enabled}
                          disabled={entry.builtin || state.busy}
                          onChange={(enabled) => void perform((manager) => manager.enable(entry.id, enabled))}
                          hideLabel
                        >
                          {language.t("settings.desktopExtensions.enable", { name: entry.name })}
                        </Switch>
                      </div>
                    </SettingsRow>
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </section>
      </div>
    </>
  )
}
