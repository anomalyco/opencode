import { Badge } from "@opencode-ai/ui/badge"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextInput } from "@opencode-ai/ui/text-input"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import fuzzysort from "fuzzysort"
import { type Component, For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { ServerRowMenu } from "@/servers/registry/row-menu"
import { ServerHealthIndicator } from "@/servers/registry/row"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName } from "@/runtime/server/registry"
import { useServerCollectionController } from "@/servers/registry/controller"
import { DialogServer } from "@/servers/connect/dialog"
import { SettingsList } from "@/settings/list"
import { AddServerMenu, isWslServer, useFilteredWslServers, WslServerSettings } from "@/servers/wsl/settings"
import "@/settings/settings.css"

export const SettingsServers: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const controller = useServerCollectionController()
  const [store, setStore] = createStore({ filter: "" })
  const wslServers = useFilteredWslServers(() => store.filter)

  const showSearch = createMemo(
    () => controller.collection.items().filter((item) => !isWslServer(item)).length + wslServers().length > 1,
  )

  const filtered = createMemo(() => {
    const items = controller.collection.items().filter((item) => !isWslServer(item))
    const query = store.filter.trim()
    if (!query) return items
    return fuzzysort
      .go(query, items, {
        keys: [(item) => serverName(item), (item) => item.http.url],
      })
      .map((result) => result.obj)
  })

  const openAdd = () => {
    void dialog.push(() => <DialogServer mode="add" />)
  }

  const openEdit = (server: ServerConnection.Http) => {
    void dialog.push(() => <DialogServer mode="edit" server={server} />)
  }

  return (
    <>
      <div
        class="settings-tab-header settings-servers-header"
        classList={{ "settings-tab-header--stacked": showSearch() }}
      >
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("status.popover.tab.servers")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.servers.description")}</span>
          </div>
          <AddServerMenu onAddServer={openAdd} />
        </div>
        <Show when={showSearch()}>
          <div class="settings-tab-search">
            <TextInput
              type="search"
              appearance="base"
              value={store.filter}
              onInput={(event) => setStore("filter", event.currentTarget.value)}
              placeholder={language.t("dialog.server.search.placeholder")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              aria-label={language.t("dialog.server.search.placeholder")}
            />
            <Show when={store.filter}>
              <IconButton
                type="button"
                variant="ghost-muted"
                size="small"
                class="settings-tab-search-clear"
                icon={<Icon name="close" size="large" class="text-v2-icon-icon-muted" />}
                onClick={() => setStore("filter", "")}
                aria-label={language.t("common.clear")}
              />
            </Show>
          </div>
        </Show>
      </div>

      <div class="settings-tab-body settings-servers">
        <Show
          when={filtered().length > 0 || wslServers().length > 0}
          fallback={
            <div class="settings-servers-status">
              <span>{store.filter ? language.t("palette.empty") : language.t("dialog.server.empty")}</span>
              <Show when={store.filter}>
                <span class="settings-servers-status-filter">&quot;{store.filter}&quot;</span>
              </Show>
            </div>
          }
        >
          <SettingsList>
            <WslServerSettings domain={controller} servers={wslServers} />
            <For each={filtered()}>
              {(item) => {
                const key = ServerConnection.key(item)
                const health = () => controller.collection.health()[key]
                const isDefault = () => controller.defaults.key() === key
                return (
                  <div class="settings-servers-row">
                    <div class="settings-servers-lead">
                      <ServerHealthIndicator health={health()} />
                      <div class="settings-servers-copy">
                        <span class="settings-servers-name">{serverName(item)}</span>
                        <Show when={health()?.version}>
                          <span class="settings-servers-meta">v{health()?.version}</span>
                        </Show>
                      </div>
                    </div>
                    <div class="settings-servers-actions">
                      <Show when={controller.defaults.available() && isDefault()}>
                        <Badge>{language.t("dialog.server.status.default")}</Badge>
                      </Show>
                      <ServerRowMenu server={item} domain={controller} onEdit={openEdit} />
                    </div>
                  </div>
                )
              }}
            </For>
          </SettingsList>
        </Show>
      </div>
    </>
  )
}
