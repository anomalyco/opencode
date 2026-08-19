import { Button } from "@opencode-ai/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { List } from "@opencode-ai/ui/list"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Switch } from "@opencode-ai/ui/switch"
import { TextInput } from "@opencode-ai/ui/text-input"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useFilteredList } from "@opencode-ai/ui/hooks"
import { For, Show, type Component } from "solid-js"
import { useLocal } from "@/context/local"
import { popularProviders } from "@/hooks/use-providers"
import { useLanguage } from "@/context/language"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { decode64 } from "@/utils/base64"
import { SettingsListV2 } from "./settings-v2/parts/list"
import { SettingsRowV2 } from "./settings-v2/parts/row"
import "./settings-v2/settings-v2.css"

type ModelItem = ReturnType<ReturnType<typeof useLocal>["model"]["list"]>[number]

export const DialogManageModels: Component = () => {
  const local = useLocal()
  const language = useLanguage()
  const dialog = useDialog()
  const directory = () => decode64(local.slug())

  const handleConnectProvider = () => {
    void dialog.show(() => <DialogConnectProvider directory={directory()} />)
  }
  const providerRank = (id: string) => popularProviders.indexOf(id)
  const providerList = (providerID: string) => local.model.list().filter((x) => x.provider.id === providerID)
  const providerVisible = (providerID: string) =>
    providerList(providerID).every((x) => local.model.visible({ modelID: x.id, providerID: x.provider.id }))
  const setProviderVisibility = (providerID: string, checked: boolean) => {
    providerList(providerID).forEach((x) => {
      local.model.setVisibility({ modelID: x.id, providerID: x.provider.id }, checked)
    })
  }

  return (
    <Dialog>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("dialog.model.manage")}
          description={language.t("dialog.model.manage.description")}
        />
        <Button class="h-7 -my-1 text-14-medium" icon="plus-small" tabIndex={-1} onClick={handleConnectProvider}>
          {language.t("command.provider.connect")}
        </Button>
      </DialogHeader>
      <DialogBody>
        <List
          class="px-3"
          search={{ placeholder: language.t("dialog.model.search.placeholder"), autofocus: true }}
          emptyMessage={language.t("dialog.model.empty")}
          key={(x) => `${x?.provider?.id}:${x?.id}`}
          items={local.model.list()}
          filterKeys={["provider.name", "name", "id"]}
          sortBy={(a, b) => a.name.localeCompare(b.name)}
          groupBy={(x) => x.provider.id}
          groupHeader={(group) => {
            const provider = group.items[0].provider
            return (
              <>
                <span>{provider.name}</span>
                <Tooltip
                  appearance="standard"
                  placement="top"
                  value={language.t("dialog.model.manage.provider.toggle", { provider: provider.name })}
                >
                  <Switch
                    appearance="standard"
                    class="-mr-1"
                    checked={providerVisible(provider.id)}
                    onChange={(checked) => setProviderVisibility(provider.id, checked)}
                    hideLabel
                  >
                    {provider.name}
                  </Switch>
                </Tooltip>
              </>
            )
          }}
          sortGroupsBy={(a, b) => {
            const aRank = providerRank(a.items[0].provider.id)
            const bRank = providerRank(b.items[0].provider.id)
            const aPopular = aRank >= 0
            const bPopular = bRank >= 0
            if (aPopular && !bPopular) return -1
            if (!aPopular && bPopular) return 1
            return aRank - bRank
          }}
          onSelect={(x) => {
            if (!x) return
            const key = { modelID: x.id, providerID: x.provider.id }
            local.model.setVisibility(key, !local.model.visible(key))
          }}
        >
          {(i) => (
            <div class="w-full flex items-center justify-between gap-x-3">
              <span>{i.name}</span>
              <div onClick={(e) => e.stopPropagation()}>
                <Switch
                  appearance="standard"
                  checked={!!local.model.visible({ modelID: i.id, providerID: i.provider.id })}
                  onChange={(checked) => {
                    local.model.setVisibility({ modelID: i.id, providerID: i.provider.id }, checked)
                  }}
                />
              </div>
            </div>
          )}
        </List>
      </DialogBody>
    </Dialog>
  )
}

export const DialogManageModelsV2: Component = () => {
  const local = useLocal()
  const language = useLanguage()
  const dialog = useDialog()
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
      return aRank - bRank
    },
  })

  return (
    <Dialog size="large" variant="settings" class="settings-v2-manage-models-dialog">
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
                class="settings-v2-tab-search-clear"
                icon={<Icon name="close" size="large" class="text-v2-icon-icon-muted" />}
                onClick={() => list.clear()}
                aria-label={language.t("common.clear")}
              />
            </Show>
          </div>
        </div>
        <div data-slot="manage-models-scroll" class="relative min-h-0 flex-1">
          <div class="settings-v2-panel settings-v2-models h-full px-4 pt-4 pb-4">
            <Show
              when={!list.grouped.loading}
              fallback={
                <div class="settings-v2-models-status">
                  {language.t("common.loading")}
                  {language.t("common.loading.ellipsis")}
                </div>
              }
            >
              <Show
                when={list.flat().length > 0}
                fallback={
                  <div class="settings-v2-models-status">
                    <span>{language.t("dialog.model.empty")}</span>
                    <Show when={list.filter()}>
                      <span class="settings-v2-models-status-filter">&quot;{list.filter()}&quot;</span>
                    </Show>
                  </div>
                }
              >
                <For each={list.grouped.latest}>
                  {(group) => (
                    <div class="settings-v2-section" data-component="settings-models-provider">
                      <div class="settings-v2-models-group-header justify-between">
                        <div class="flex min-w-0 items-center gap-2">
                          <ProviderIcon id={group.category} width={16} height={16} class="ml-4 shrink-0" />
                          <h3 class="settings-v2-section-title">{group.items[0].provider.name}</h3>
                        </div>
                        <div>
                          <Switch
                            class="mr-6"
                            checked={providerVisible(group.category)}
                            onChange={(checked) => setProviderVisibility(group.category, checked)}
                            hideLabel
                          >
                            {group.items[0].provider.name}
                          </Switch>
                        </div>
                      </div>
                      <SettingsListV2>
                        <For each={group.items}>
                          {(item) => (
                            <SettingsRowV2 title={item.name} description="">
                              <div>
                                <Switch
                                  checked={local.model.visible({ modelID: item.id, providerID: item.provider.id })}
                                  onChange={(checked) => setModelVisibility(item, checked)}
                                  hideLabel
                                >
                                  {item.name}
                                </Switch>
                              </div>
                            </SettingsRowV2>
                          )}
                        </For>
                      </SettingsListV2>
                    </div>
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
