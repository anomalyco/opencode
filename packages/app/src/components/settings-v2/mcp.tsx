import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import fuzzysort from "fuzzysort"
import { type Accessor, type Component, For, Show, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import type { McpServerConfig } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { DialogMcpV2 } from "./dialog-mcp-v2"
import { SettingsListV2 } from "./parts/list"
import "./settings-v2.css"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  needs_client_registration: "mcp.status.needs_client_registration",
  disabled: "mcp.status.disabled",
} as const

type ConfigEntry = McpServerConfig | { enabled?: boolean }

function isConfigured(entry: ConfigEntry | undefined): entry is McpServerConfig {
  return !!entry && typeof entry === "object" && "type" in entry
}

export const SettingsMcpV2: Component<{ directory: Accessor<string | undefined> }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSync = useServerSync()
  const [store, setStore] = createStore({ filter: "" })
  const [busy, setBusy] = createSignal(false)

  // MCP config is global, but test/connect need an instance to run against. Fall
  // back to the first open project when the settings dialog has no active directory.
  const directory = createMemo(() => props.directory() ?? serverSync().data.project?.[0]?.worktree)

  const servers = createMemo(() => {
    const config = (serverSync().data.config.mcp ?? {}) as Record<string, ConfigEntry>
    return Object.entries(config)
      .filter(([, entry]) => isConfigured(entry))
      .map(([name, entry]) => ({ name, config: entry as McpServerConfig }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  const statusMap = createMemo(() => {
    const dir = directory()
    if (!dir) return {} as Record<string, { status?: string }>
    return serverSync().child(dir, { mcp: true })[0].mcp ?? {}
  })
  const liveStatus = (name: string) => statusMap()[name]?.status

  const showSearch = createMemo(() => servers().length > 1)

  const filtered = createMemo(() => {
    const items = servers()
    const query = store.filter.trim()
    if (!query) return items
    return fuzzysort.go(query, items, { keys: [(item) => item.name] }).map((result) => result.obj)
  })

  const run = async (fn: (dir: string) => Promise<unknown>, failKey: string) => {
    const dir = directory()
    if (!dir) {
      showToast({ variant: "error", title: language.t(failKey), description: language.t("settings.mcp.noWorkspace") })
      return
    }
    setBusy(true)
    try {
      await fn(dir)
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t(failKey),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  const openAdd = () => dialog.push(() => <DialogMcpV2 mode="add" directory={directory} />)
  const openEdit = (name: string, config: McpServerConfig) =>
    dialog.push(() => <DialogMcpV2 mode="edit" name={name} config={config} directory={directory} />)

  const statusLabel = (name: string) => {
    const status = liveStatus(name)
    const key = status ? statusLabels[status as keyof typeof statusLabels] : undefined
    return key ? language.t(key) : undefined
  }

  const summary = (config: McpServerConfig) => (config.type === "local" ? config.command.join(" ") : config.url)

  const toggleEnabled = (name: string, config: McpServerConfig) =>
    run((dir) => serverSync().mcp.save(dir, name, { ...config, enabled: config.enabled === false }), "settings.mcp.toast.saveFailed")

  const removeServer = (name: string) => run((dir) => serverSync().mcp.remove(dir, name), "settings.mcp.toast.removeFailed")

  const authenticate = (name: string) => run((dir) => serverSync().mcp.toggle(dir, name), "common.requestFailed")

  return (
    <>
      <div
        class="settings-v2-tab-header settings-v2-servers-header"
        classList={{ "settings-v2-tab-header--stacked": showSearch() }}
      >
        <div class="settings-v2-tab-header-row">
          <h2 class="settings-v2-tab-title">{language.t("settings.mcp.title")}</h2>
          <ButtonV2 variant="contrast" onClick={openAdd}>
            {language.t("settings.mcp.add")}
          </ButtonV2>
        </div>
        <Show when={showSearch()}>
          <div class="settings-v2-tab-search">
            <TextInputV2
              type="search"
              appearance="base"
              value={store.filter}
              onInput={(event) => setStore("filter", event.currentTarget.value)}
              placeholder={language.t("settings.mcp.search.placeholder")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              aria-label={language.t("settings.mcp.search.placeholder")}
            />
            <Show when={store.filter}>
              <IconButtonV2
                type="button"
                variant="ghost-muted"
                size="small"
                class="settings-v2-tab-search-clear"
                icon={<IconV2 name="close" size="large" class="text-v2-icon-icon-muted" />}
                onClick={() => setStore("filter", "")}
              />
            </Show>
          </div>
        </Show>
      </div>

      <div class="settings-v2-tab-body settings-v2-servers">
        <Show
          when={filtered().length > 0}
          fallback={
            <div class="settings-v2-servers-status">
              <span>{store.filter ? language.t("palette.empty") : language.t("settings.mcp.empty")}</span>
            </div>
          }
        >
          <SettingsListV2>
            <For each={filtered()}>
              {(item) => {
                const enabled = () => item.config.enabled !== false
                return (
                  <div class="settings-v2-mcp-row">
                    <div class="settings-v2-mcp-row-lead">
                      <div class="flex items-center gap-2">
                        <span class="settings-v2-mcp-row-name">{item.name}</span>
                        <Tag>
                          {item.config.type === "local"
                            ? language.t("settings.mcp.type.local")
                            : language.t("settings.mcp.type.remote")}
                        </Tag>
                        <Show when={statusLabel(item.name)}>
                          <span class="settings-v2-mcp-row-meta">{statusLabel(item.name)}</span>
                        </Show>
                      </div>
                      <span class="settings-v2-mcp-row-meta truncate">{summary(item.config)}</span>
                    </div>
                    <div class="settings-v2-mcp-row-actions">
                      <Show when={liveStatus(item.name) === "needs_auth"}>
                        <ButtonV2 variant="outline" disabled={busy()} onClick={() => authenticate(item.name)}>
                          {language.t("settings.mcp.menu.authenticate")}
                        </ButtonV2>
                      </Show>
                      <Switch
                        checked={enabled()}
                        disabled={busy()}
                        hideLabel
                        onChange={() => toggleEnabled(item.name, item.config)}
                      >
                        {language.t("dialog.mcp.form.enabled")}
                      </Switch>
                      <ButtonV2 variant="neutral" disabled={busy()} onClick={() => openEdit(item.name, item.config)}>
                        {language.t("settings.mcp.menu.edit")}
                      </ButtonV2>
                      <ButtonV2 variant="danger" disabled={busy()} onClick={() => removeServer(item.name)}>
                        {language.t("settings.mcp.menu.remove")}
                      </ButtonV2>
                    </div>
                  </div>
                )
              }}
            </For>
          </SettingsListV2>
        </Show>
      </div>
    </>
  )
}
