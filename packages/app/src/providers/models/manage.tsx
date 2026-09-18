import { Button } from "@opencode/ui/button"
import { Badge } from "@opencode/ui/badge"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { useFilteredList } from "@opencode/ui/hooks"
import { createMemo, For, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal } from "@/providers/models/selection"
import { popularProviders } from "@/providers/catalog/providers"
import { useLanguage } from "@/runtime/i18n/language"
import { useDialog } from "@opencode/ui/context/dialog"
import { DialogConnectProvider } from "@/providers/connect/dialog"
import { decode64 } from "@/runtime/persistence/base64"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { OpenCodeLogo } from "@/providers/opencode-logo"
import { consoleProviderGroup, consoleProviderName } from "@/providers/catalog/console"
import { ProviderModelGroup, ProviderModelIcon } from "@/providers/models/provider-group"
import "@/settings/settings.css"

type ModelItem = ReturnType<ReturnType<typeof useLocal>["model"]["list"]>[number]
type ModelGroup = { category: string; items: ModelItem[] }
type ConsoleGroup = NonNullable<ReturnType<typeof consoleProviderGroup<ModelItem["provider"]>>>
type DisplayGroup =
  | { type: "provider"; group: ModelGroup }
  | { type: "console"; managed: ConsoleGroup; providers: ModelGroup[] }

const CONSOLE_GROUP_KEY = "console:opencode"

export const DialogManageModels: Component = () => {
  const local = useLocal()
  const language = useLanguage()
  const dialog = useDialog()
  const [store, setStore] = createStore({ collapsed: {} as Record<string, boolean> })
  const directory = () => decode64(local.slug())

  const handleConnectProvider = () => {
    void dialog.show(() => <DialogConnectProvider directory={directory()} />)
  }
  const providerList = (providerID: string) => local.model.list().filter((x) => x.provider.id === providerID)
  const providerVisible = (providerID: string) =>
    providerList(providerID).every((x) => local.model.visible({ modelID: x.id, providerID: x.provider.id }))
  const setProviderVisibility = (providerID: string, checked: boolean) => {
    providerList(providerID).forEach((x) => {
      local.model.setVisibility({ modelID: x.id, providerID: x.provider.id }, checked)
    })
  }
  const setModelVisibility = (item: ModelItem, checked: boolean) => {
    local.model.setVisibility({ modelID: item.id, providerID: item.provider.id }, checked)
  }
  const list = useFilteredList<ModelItem>({
    items: () => local.model.list(),
    key: (x) => `${x.provider.id}:${x.id}`,
    filterKeys: ["provider.name", "name", "id"],
    sortBy: (a, b) => a.name.localeCompare(b.name),
    groupBy: (x) => x.provider.id,
    sortGroupsBy: (a, b) => {
      const aRank = popularProviders.indexOf(a.category)
      const bRank = popularProviders.indexOf(b.category)
      const aPopular = aRank >= 0
      const bPopular = bRank >= 0
      if (aPopular && !bPopular) return -1
      if (!aPopular && bPopular) return 1
      if (aPopular && bPopular) return aRank - bRank
      return a.items[0].provider.name.localeCompare(b.items[0].provider.name)
    },
  })
  const consoleGroup = createMemo(() =>
    consoleProviderGroup([...new Map(local.model.list().map((item) => [item.provider.id, item.provider])).values()]),
  )
  const groups = createMemo<DisplayGroup[]>(() => {
    const managed = consoleGroup()
    if (!managed) return list.grouped.latest.map((group) => ({ type: "provider" as const, group }))
    const ids = new Set(managed.providers.map((provider) => provider.id))
    const providers = list.grouped.latest.filter((group) => ids.has(group.category))
    if (providers.length === 0) return list.grouped.latest.map((group) => ({ type: "provider" as const, group }))
    const first = list.grouped.latest.findIndex((group) => ids.has(group.category))
    return list.grouped.latest.flatMap<DisplayGroup>((group, index) => {
      if (!ids.has(group.category)) return [{ type: "provider" as const, group }]
      if (index !== first) return []
      return [{ type: "console" as const, managed, providers }]
    })
  })
  const searching = () => list.filter().length > 0
  const expanded = (key: string) => searching() || !store.collapsed[key]
  const providerName = (provider: ModelItem["provider"]) =>
    provider.id === "opencode" ? language.t("provider.connect.opencode.freeName") : provider.name
  const enabled = createMemo(() =>
    local.model.list().reduce((counts, item) => {
      if (!local.model.visible({ providerID: item.provider.id, modelID: item.id })) return counts
      counts.set(item.provider.id, (counts.get(item.provider.id) ?? 0) + 1)
      return counts
    }, new Map<string, number>()),
  )

  function ModelRows(props: { items: ModelItem[] }) {
    return (
      <SettingsList variant="catalog">
        <For each={props.items}>
          {(item) => (
            <SettingsRow title={item.name} description="">
              <div>
                <Switch
                  checked={local.model.visible({ modelID: item.id, providerID: item.provider.id })}
                  onChange={(checked) => setModelVisibility(item, checked)}
                  hideLabel
                >
                  {item.name}
                </Switch>
              </div>
            </SettingsRow>
          )}
        </For>
      </SettingsList>
    )
  }

  return (
    <Dialog size="large" variant="settings" class="settings-manage-models-dialog">
      <DialogHeader hideClose={true} closeLabel={language.t("common.close")}>
        <DialogTitleGroup
          title={language.t("dialog.model.manage")}
          description={language.t("dialog.model.manage.description")}
        />
        <Button variant="neutral" icon="plus" onClick={handleConnectProvider}>
          {language.t("command.provider.connect")}
        </Button>
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-1 flex-col">
        <div class="px-4 pt-px pb-3">
          <div class="relative">
            <TextInput
              type="search"
              appearance="base"
              class="!w-full self-stretch"
              value={list.filter()}
              onInput={(event) => list.onInput(event.currentTarget.value)}
              placeholder={language.t("dialog.model.search.placeholder")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              autofocus
              aria-label={language.t("dialog.model.search.placeholder")}
            />
            <Show when={list.filter()}>
              <IconButton
                type="button"
                variant="ghost-muted"
                size="small"
                class="settings-tab-search-clear"
                icon={<Icon name="close" size="large" class="text-v2-icon-icon-muted" />}
                onClick={() => list.clear()}
                aria-label={language.t("common.clear")}
              />
            </Show>
          </div>
        </div>
        <div data-slot="manage-models-scroll" class="relative min-h-0 flex-1">
          <div class="settings-panel settings-models h-full px-4 pt-1 pb-4">
            <Show
              when={!list.grouped.loading}
              fallback={
                <div class="settings-models-status">
                  {language.t("common.loading")}
                  {language.t("common.loading.ellipsis")}
                </div>
              }
            >
              <Show
                when={list.flat().length > 0}
                fallback={
                  <div class="settings-models-status">
                    <span>{language.t("dialog.model.empty")}</span>
                    <Show when={list.filter()}>
                      <span class="settings-models-status-filter">&quot;{list.filter()}&quot;</span>
                    </Show>
                  </div>
                }
              >
                <For each={groups()}>
                  {(item) => (
                    <Show
                      when={item.type === "console" ? item : undefined}
                      fallback={
                        <Show when={item.type === "provider" ? item.group : undefined}>
                          {(group) => (
                            <div
                              class="settings-section"
                              data-component="settings-models-provider"
                              data-expanded={expanded(group().category) ? "" : undefined}
                            >
                              <div class="settings-models-group-header justify-between">
                                <button
                                  type="button"
                                  class="settings-models-group-trigger"
                                  aria-expanded={expanded(group().category)}
                                  disabled={searching()}
                                  onClick={() => setStore("collapsed", group().category, expanded(group().category))}
                                >
                                  <span class="settings-models-group-chevron">
                                    <Icon
                                      name="chevron-down"
                                      size="small"
                                      classList={{ collapsed: !expanded(group().category) }}
                                    />
                                  </span>
                                  <span class="settings-models-group-label">
                                    <ProviderModelIcon provider={group().items[0].provider} class="shrink-0" />
                                    <bdi class="settings-models-group-title">
                                      {providerName(group().items[0].provider)}
                                    </bdi>
                                  </span>
                                </button>
                                <Switch
                                  class="me-6"
                                  checked={providerVisible(group().category)}
                                  onChange={(checked) => setProviderVisibility(group().category, checked)}
                                  hideLabel
                                >
                                  {group().items[0].provider.name}
                                </Switch>
                              </div>
                              <Show when={expanded(group().category)}>
                                <ModelRows items={group().items} />
                              </Show>
                            </div>
                          )}
                        </Show>
                      }
                    >
                      {(console) => (
                        <div
                          class="settings-section settings-models-console"
                          data-component="manage-models-console"
                          data-expanded={expanded(CONSOLE_GROUP_KEY) ? "" : undefined}
                        >
                          <div class="settings-models-group-header">
                            <button
                              type="button"
                              class="settings-models-group-trigger"
                              aria-expanded={expanded(CONSOLE_GROUP_KEY)}
                              disabled={searching()}
                              onClick={() => setStore("collapsed", CONSOLE_GROUP_KEY, expanded(CONSOLE_GROUP_KEY))}
                            >
                              <span class="settings-models-group-chevron">
                                <Icon
                                  name="chevron-down"
                                  size="small"
                                  classList={{ collapsed: !expanded(CONSOLE_GROUP_KEY) }}
                                />
                              </span>
                              <span class="settings-models-group-label">
                                <OpenCodeLogo class="settings-models-provider-icon size-4 shrink-0" />
                                <span class="settings-models-group-title">
                                  {language.t("provider.connect.opencode.name")}
                                </span>
                                <Badge>{console().managed.workspace}</Badge>
                              </span>
                            </button>
                          </div>
                          <Show when={expanded(CONSOLE_GROUP_KEY)}>
                            <div class="provider-model-groups settings-models-console-groups">
                              <For each={console().providers}>
                                {(group) => {
                                  const count = () => enabled().get(group.category) ?? 0
                                  return (
                                    <ProviderModelGroup
                                      provider={group.items[0].provider}
                                      name={consoleProviderName(console().managed, group.items[0].provider.name)}
                                      expanded={expanded(group.category)}
                                      disabled={searching()}
                                      detail={language.plural("settings.models.enabled", count(), { count: count() })}
                                      onExpandedChange={(value) => setStore("collapsed", group.category, !value)}
                                    >
                                      <ModelRows items={group.items} />
                                    </ProviderModelGroup>
                                  )
                                }}
                              </For>
                            </div>
                          </Show>
                        </div>
                      )}
                    </Show>
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </div>
      </DialogBody>
    </Dialog>
  )
}
