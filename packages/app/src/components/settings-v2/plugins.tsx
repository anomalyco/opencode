import fuzzysort from "fuzzysort"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitleGroup,
} from "@opencode-ai/ui/v2/dialog-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { type Accessor, type Component, For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServerSync } from "@/context/server-sync"
import { useTabs } from "@/context/tabs"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import type { CatalogEntry, PluginConfigsPayload, PluginEntry } from "./plugins-types"
import "./settings-v2.css"

const entryName = (entry: PluginEntry) => (typeof entry === "string" ? entry : entry[0])

type Scope = "global" | "project"

const SCOPES: Scope[] = ["global", "project"]

let lastScope: Scope | undefined

const orderedScopes = () => (lastScope ? [lastScope, ...SCOPES.filter((scope) => scope !== lastScope)] : SCOPES)

const EMPTY_CONFIGS: PluginConfigsPayload = {
  global: [],
  project: [],
  recentlyRemoved: [],
  paths: { global: "", project: null },
}

const EMPTY_CATALOG = { entries: [], fetchedAt: 0, stale: false }

export const SettingsPluginsV2: Component<{}> = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const layout = useLayout()
  const tabs = useTabs()
  const serverSync = useServerSync()

  const [view, setView] = createSignal<"browse" | "installed">("browse")
  const [query, setQuery] = createSignal("")
  const [sourceFilter, setSourceFilter] = createSignal<"all" | "ecosystem" | "awesome" | "cafe">("all")
  const [busy, setBusy] = createSignal(false)
  const [copied, setCopied] = createSignal<string | undefined>()
  const [configsError, setConfigsError] = createSignal<string | undefined>()

  const projectDir = createMemo(() => {
    const route = layout.route()
    if (route.type === "dir-new-sesssion") return route.dir
    if (route.type === "draft") {
      const draft = tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
      return draft?.type === "draft" ? draft.directory : undefined
    }
    if (route.type === "session") return serverSync().session.get(route.sessionId)?.directory
    return undefined
  })

  const [catalog] = createResource(async () => {
    const manager = platform.plugins
    if (!manager) return EMPTY_CATALOG
    try {
      return await manager.fetchCatalog()
    } catch {
      showToast({ description: language.t("settings.plugins.errors.catalog"), variant: "error" })
      return EMPTY_CATALOG
    }
  })

  const [configs, configsActions] = createResource(projectDir, async (dir) => {
    const manager = platform.plugins
    if (!manager) return EMPTY_CONFIGS
    setConfigsError(undefined)
    try {
      const payload = await manager.readConfigs(dir)
      // Parse failures arrive as structured entries (scope, path, message);
      // surface the first so the UI can offer the Open-config action.
      const first = payload.errors?.[0]
      setConfigsError(first ? first.path : undefined)
      return payload
    } catch (error) {
      const path = (error as { path?: unknown })?.path
      setConfigsError(
        typeof path === "string"
          ? path
          : error instanceof Error
            ? error.message.split("\n")[0]
            : undefined,
      )
      return EMPTY_CONFIGS
    }
  })

  const filtered = createMemo(() => {
    const source = sourceFilter()
    const base = source === "all" ? (catalog()?.entries ?? []) : (catalog()?.entries ?? []).filter((entry) => entry.source === source)
    const q = query().trim().toLowerCase()
    if (!q) return base
    return fuzzysort
      .go(q, base, {
        keys: [(entry) => entry.name, (entry) => entry.description ?? ""],
      })
      .map((result) => result.obj)
  })

  const installed = createMemo(() => {
    const c = configs() ?? EMPTY_CONFIGS
    return [
      ...c.global.map((entry) => ({ entry, scope: "global" as Scope })),
      ...c.project.map((entry) => ({ entry, scope: "project" as Scope })),
    ]
  })

  const staleAge = () => {
    const fetchedAt = catalog()?.fetchedAt
    if (!fetchedAt) return ""
    return `${Math.max(1, Math.round((Date.now() - fetchedAt) / 3_600_000))}h`
  }

  const configSnippet = (entry: CatalogEntry) => JSON.stringify({ plugin: [entry.name] }, null, 2)

  const copySnippet = (entry: CatalogEntry) => {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
    if (!clipboard?.writeText) return
    void clipboard.writeText(configSnippet(entry)).then(() => {
      setCopied(entry.name)
      setTimeout(() => setCopied((current) => (current === entry.name ? undefined : current)), 2000)
    })
  }

  const openInstall = (name: string, entry?: PluginEntry) => {
    void dialog.push(() => (
      <DialogInstallPlugin
        name={name}
        entry={entry}
        projectDir={projectDir}
        onInstalled={() => void configsActions.refetch()}
      />
    ))
  }

  const remove = async (name: string, scope: Scope, remember: boolean) => {
    const manager = platform.plugins
    if (!manager || busy()) return
    setBusy(true)
    try {
      await manager.remove(name, scope, remember, projectDir())
      void configsActions.refetch()
    } catch {
      // Surface the failure; refetch in case the removal partially succeeded.
      showToast({ description: language.t("common.requestFailed"), variant: "error" })
      void configsActions.refetch()
    } finally {
      setBusy(false)
    }
  }

  const confirmUninstall = (name: string, scope: Scope) => {
    void dialog.push(() => (
      <Dialog>
        <DialogHeader>
          <DialogTitleGroup
            title={language.t("settings.plugins.installed.uninstall")}
            description={language.t("settings.plugins.installed.uninstallBody", {
              name,
              scope: language.t(`settings.plugins.installed.provenance.${scope}`),
            })}
          />
        </DialogHeader>
        <DialogFooter>
          <ButtonV2 variant="neutral" onClick={() => dialog.close()}>
            {language.t("settings.plugins.install.cancel")}
          </ButtonV2>
          <ButtonV2
            variant="danger"
            onClick={() => {
              dialog.close()
              void remove(name, scope, false)
            }}
          >
            {language.t("settings.plugins.installed.uninstall")}
          </ButtonV2>
        </DialogFooter>
      </Dialog>
    ))
  }

  const openConfig = (path: string) => {
    if (platform.platform !== "desktop" || !platform.openPath) return
    void platform.openPath(path)
  }

  const formatDownloads = (n?: number) =>
    n === undefined ? "" : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n)

  return (
    <>
      <div
        class="settings-v2-tab-header settings-v2-plugins-header"
        classList={{ "settings-v2-tab-header--stacked": view() === "browse" }}
      >
        <div class="settings-v2-tab-header-row">
          <h2 class="settings-v2-tab-title">{language.t("settings.tab.plugins")}</h2>
          <div class="flex items-center gap-2">
            <ButtonV2
              size="normal"
              variant={view() === "browse" ? "neutral" : "ghost-muted"}
              onClick={() => setView("browse")}
            >
              {language.t("settings.plugins.section.browse")}
            </ButtonV2>
            <ButtonV2
              size="normal"
              variant={view() === "installed" ? "neutral" : "ghost-muted"}
              onClick={() => setView("installed")}
            >
              {language.t("settings.plugins.section.installed")}
            </ButtonV2>
          </div>
        </div>
        <Show when={view() === "browse"}>
          <div class="settings-v2-tab-search">
            <div class="flex items-center gap-2">
              <ButtonV2
                size="normal"
                variant={sourceFilter() === "all" ? "neutral" : "ghost-muted"}
                onClick={() => setSourceFilter("all")}
              >
                {language.t("settings.plugins.source.all")}
              </ButtonV2>
              <ButtonV2
                size="normal"
                variant={sourceFilter() === "ecosystem" ? "neutral" : "ghost-muted"}
                onClick={() => setSourceFilter("ecosystem")}
              >
                {language.t("settings.plugins.source.ecosystem")}
              </ButtonV2>
              <ButtonV2
                size="normal"
                variant={sourceFilter() === "awesome" ? "neutral" : "ghost-muted"}
                onClick={() => setSourceFilter("awesome")}
              >
                {language.t("settings.plugins.source.awesome")}
              </ButtonV2>
              <ButtonV2
                size="normal"
                variant={sourceFilter() === "cafe" ? "neutral" : "ghost-muted"}
                onClick={() => setSourceFilter("cafe")}
              >
                {language.t("settings.plugins.source.cafe")}
              </ButtonV2>
            </div>
            <TextInputV2
              type="search"
              appearance="base"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder={language.t("settings.plugins.search.placeholder")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              aria-label={language.t("settings.plugins.search.placeholder")}
            />
          </div>
        </Show>
      </div>

      <div class="settings-v2-tab-body settings-v2-plugins">
        <Show when={view() === "browse"}>
          <Show when={catalog()?.stale}>
            <div class="settings-v2-plugins-note">
              {language.t("settings.plugins.stale", { age: staleAge() })}
            </div>
          </Show>
          <Show
            when={!catalog.loading && filtered().length > 0}
            fallback={
              <div class="settings-v2-plugins-note">
                {catalog.loading
                  ? `${language.t("common.loading")}${language.t("common.loading.ellipsis")}`
                  : language.t("palette.empty")}
              </div>
            }
          >
            <SettingsListV2>
              <For each={filtered()}>
                {(entry) => (
                  <SettingsRowV2
                    title={entry.name}
                    description={
                      <>
                        {entry.description}
                        <Show when={entry.downloadsLastWeek !== undefined}>
                          {" · "}
                          {formatDownloads(entry.downloadsLastWeek)}/wk
                        </Show>
                        <Show when={!entry.onNpm}>
                          {" · "}
                          {language.t("settings.plugins.detail.notOnNpm")}
                        </Show>
                      </>
                    }
                  >
                    <div class="flex gap-2">
                      <ButtonV2 size="normal" variant="ghost-muted" onClick={() => copySnippet(entry)}>
                        {copied() === entry.name
                          ? language.t("settings.plugins.detail.copied")
                          : language.t("settings.plugins.detail.copy")}
                      </ButtonV2>
                      <Show when={entry.onNpm}>
                        <ButtonV2 size="normal" variant="neutral" onClick={() => openInstall(entry.name)}>
                          {language.t("settings.plugins.detail.install")}
                        </ButtonV2>
                      </Show>
                    </div>
                  </SettingsRowV2>
                )}
              </For>
            </SettingsListV2>
          </Show>
        </Show>

        <Show when={view() === "installed"}>
          <Show when={configsError()}>
            {(message) => (
              <div class="settings-v2-plugins-note">
                {language.t("settings.plugins.errors.parseFailed", { path: message() })}
              </div>
            )}
          </Show>
          <Show when={platform.openPath && (configs()?.paths.global || configs()?.paths.project)}>
            <SettingsListV2>
              <Show when={configs()?.paths.global}>
                {(path) => (
                  <SettingsRowV2
                    title={language.t("settings.plugins.installed.provenance.global")}
                    description={path()}
                  >
                    <ButtonV2 size="normal" variant="ghost-muted" onClick={() => openConfig(path())}>
                      {language.t("settings.plugins.installed.openConfig")}
                    </ButtonV2>
                  </SettingsRowV2>
                )}
              </Show>
              <Show when={configs()?.paths.project}>
                {(path) => (
                  <SettingsRowV2
                    title={language.t("settings.plugins.installed.provenance.project")}
                    description={path()}
                  >
                    <ButtonV2 size="normal" variant="ghost-muted" onClick={() => openConfig(path())}>
                      {language.t("settings.plugins.installed.openConfig")}
                    </ButtonV2>
                  </SettingsRowV2>
                )}
              </Show>
            </SettingsListV2>
          </Show>
          <Show
            when={installed().length > 0}
            fallback={<div class="settings-v2-plugins-note">{language.t("settings.plugins.installed.empty")}</div>}
          >
            <SettingsListV2>
              <For each={installed()}>
                {(item) => (
                  <SettingsRowV2
                    title={entryName(item.entry)}
                    description={
                      <Tag>
                        {item.scope === "global"
                          ? language.t("settings.plugins.installed.provenance.global")
                          : language.t("settings.plugins.installed.provenance.project")}
                      </Tag>
                    }
                  >
                    <div class="flex gap-2">
                      <ButtonV2
                        size="normal"
                        variant="ghost-muted"
                        disabled={busy()}
                        onClick={() => void remove(entryName(item.entry), item.scope, true)}
                      >
                        {language.t("settings.plugins.installed.disable")}
                      </ButtonV2>
                      <ButtonV2
                        size="normal"
                        variant="ghost-muted"
                        disabled={busy()}
                        onClick={() => confirmUninstall(entryName(item.entry), item.scope)}
                      >
                        {language.t("settings.plugins.installed.uninstall")}
                      </ButtonV2>
                    </div>
                  </SettingsRowV2>
                )}
              </For>
            </SettingsListV2>
          </Show>
          <Show when={(configs()?.recentlyRemoved ?? []).length > 0}>
            <div class="settings-v2-section">
              <h3 class="settings-v2-section-title">{language.t("settings.plugins.installed.recentlyRemoved")}</h3>
              <SettingsListV2>
                <For each={configs()?.recentlyRemoved ?? []}>
                  {(item) => (
                    <SettingsRowV2
                      title={item.name}
                      description={
                        <Tag>
                          {item.scope === "global"
                            ? language.t("settings.plugins.installed.provenance.global")
                            : language.t("settings.plugins.installed.provenance.project")}
                        </Tag>
                      }
                    >
                      <ButtonV2 size="normal" variant="neutral" onClick={() => openInstall(item.name, item.entry)}>
                        {language.t("settings.plugins.installed.enable")}
                      </ButtonV2>
                    </SettingsRowV2>
                  )}
                </For>
              </SettingsListV2>
            </div>
          </Show>
        </Show>
      </div>
    </>
  )
}

const DialogInstallPlugin: Component<{
  name: string
  entry?: PluginEntry
  projectDir: Accessor<string | undefined>
  onInstalled: () => void
}> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const dialog = useDialog()
  const [busy, setBusy] = createSignal(false)

  const doInstall = async (scope: Scope) => {
    const manager = platform.plugins
    if (!manager || busy()) return
    setBusy(true)
    try {
      await manager.install(props.name, props.entry, scope, props.projectDir())
      lastScope = scope
      showToast({
        description: language.t("settings.plugins.install.success", { name: props.name }),
        variant: "success",
      })
      props.onInstalled()
      dialog.close()
    } catch {
      // Surface the failure and keep the dialog usable; refetch in case the
      // install partially succeeded before the error.
      showToast({ description: language.t("common.requestFailed"), variant: "error" })
      props.onInstalled()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("settings.plugins.install.title")}
          description={language.t("settings.plugins.install.description", { name: props.name })}
        />
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col gap-4 px-4 pt-4 pb-2">
        <div class="flex flex-col gap-2">
          <For each={orderedScopes().filter((scope) => scope === "global" || !!props.projectDir())}>
            {(scope) => (
              <ButtonV2
                size="normal"
                variant="outline"
                class="w-full justify-center"
                disabled={busy()}
                onClick={() => void doInstall(scope)}
              >
                {language.t(
                  scope === "global" ? "settings.plugins.install.global" : "settings.plugins.install.project",
                )}
              </ButtonV2>
            )}
          </For>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={busy()} onClick={() => dialog.close()}>
          {language.t("settings.plugins.install.cancel")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
