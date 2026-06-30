import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Switch } from "@opencode-ai/ui/switch"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { Button } from "@opencode-ai/ui/button"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog as DialogV2, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/v2/dialog-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { Switch as SwitchV2 } from "@opencode-ai/ui/v2/switch-v2"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { useFilteredList } from "@opencode-ai/ui/hooks"
import { For, type Component, Show } from "solid-js"
import { useLocal } from "@/context/local"
import { popularProviders } from "@/hooks/use-providers"
import { useLanguage } from "@/context/language"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectProvider } from "./dialog-select-provider"
import { decode64 } from "@/utils/base64"
import { SettingsListV2 } from "./settings-v2/parts/list"
import { SettingsRowV2 } from "./settings-v2/parts/row"
import "./settings-v2/settings-v2.css"

type ModelItem = ReturnType<ReturnType<typeof useLocal>["model"]["list"]>[number]

function useManageModelsController() {
  const local = useLocal()
  const language = useLanguage()
  const dialog = useDialog()
  const directory = () => decode64(local.slug())

  const connectProvider = () => {
    dialog.show(() => <DialogSelectProvider directory={directory} />)
  }

  const providerList = (providerID: string) => local.model.list().filter((item) => item.provider.id === providerID)
  const providerVisible = (providerID: string) =>
    providerList(providerID).every((item) => local.model.visible({ modelID: item.id, providerID: item.provider.id }))
  const setProviderVisibility = (providerID: string, checked: boolean) => {
    providerList(providerID).forEach((item) => {
      local.model.setVisibility({ modelID: item.id, providerID: item.provider.id }, checked)
    })
  }
  const setModelVisibility = (item: ModelItem, checked: boolean) => {
    local.model.setVisibility({ modelID: item.id, providerID: item.provider.id }, checked)
  }

  const list = useFilteredList<ModelItem>({
    items: () => local.model.list(),
    key: (item) => `${item.provider.id}:${item.id}`,
    filterKeys: ["provider.name", "name", "id"],
    sortBy: (a, b) => a.name.localeCompare(b.name),
    groupBy: (item) => item.provider.id,
    sortGroupsBy: (a, b) => {
      const aIndex = popularProviders.indexOf(a.category)
      const bIndex = popularProviders.indexOf(b.category)
      const aPopular = aIndex >= 0
      const bPopular = bIndex >= 0

      if (aPopular && !bPopular) return -1
      if (!aPopular && bPopular) return 1
      if (aPopular && bPopular) return aIndex - bIndex
      return a.items[0].provider.name.localeCompare(b.items[0].provider.name)
    },
    onSelect: (item) => {
      if (!item) return
      setModelVisibility(item, !local.model.visible({ modelID: item.id, providerID: item.provider.id }))
    },
  })

  return {
    language,
    local,
    list,
    connectProvider,
    providerVisible,
    setProviderVisibility,
    setModelVisibility,
  }
}

export const DialogManageModels: Component = () => {
  const controller = useManageModelsController()

  return (
    <Dialog
      title={controller.language.t("dialog.model.manage")}
      description={controller.language.t("dialog.model.manage.description")}
      action={
        <Button class="h-7 -my-1 text-14-medium" icon="plus-small" tabIndex={-1} onClick={controller.connectProvider}>
          {controller.language.t("command.provider.connect")}
        </Button>
      }
    >
      <List
        class="px-3"
        search={{ placeholder: controller.language.t("dialog.model.search.placeholder"), autofocus: true }}
        emptyMessage={controller.language.t("dialog.model.empty")}
        key={(item) => `${item?.provider?.id}:${item?.id}`}
        items={controller.local.model.list()}
        filterKeys={["provider.name", "name", "id"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        groupBy={(item) => item.provider.id}
        groupHeader={(group) => {
          const provider = group.items[0].provider
          return (
            <>
              <span>{provider.name}</span>
              <Tooltip
                placement="top"
                value={controller.language.t("dialog.model.manage.provider.toggle", { provider: provider.name })}
              >
                <Switch
                  class="-mr-1"
                  checked={controller.providerVisible(provider.id)}
                  onChange={(checked) => controller.setProviderVisibility(provider.id, checked)}
                  hideLabel
                >
                  {provider.name}
                </Switch>
              </Tooltip>
            </>
          )
        }}
        sortGroupsBy={(a, b) => {
          const aIndex = popularProviders.indexOf(a.items[0].provider.id)
          const bIndex = popularProviders.indexOf(b.items[0].provider.id)
          const aPopular = aIndex >= 0
          const bPopular = bIndex >= 0

          if (aPopular && !bPopular) return -1
          if (!aPopular && bPopular) return 1
          if (aPopular && bPopular) return aIndex - bIndex
          return a.items[0].provider.name.localeCompare(b.items[0].provider.name)
        }}
        onSelect={(item) => {
          if (!item) return
          controller.setModelVisibility(
            item,
            !controller.local.model.visible({ modelID: item.id, providerID: item.provider.id }),
          )
        }}
      >
        {(item) => (
          <div class="w-full flex items-center justify-between gap-x-3">
            <span>{item.name}</span>
            <div onClick={(event) => event.stopPropagation()}>
              <Switch
                checked={!!controller.local.model.visible({ modelID: item.id, providerID: item.provider.id })}
                onChange={(checked) => {
                  controller.setModelVisibility(item, checked)
                }}
              />
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}

export const DialogManageModelsV2: Component = () => {
  const controller = useManageModelsController()

  return (
    <DialogV2 size="large" variant="settings" class="settings-v2-manage-models-dialog">
      <DialogHeader hideClose={true} closeLabel={controller.language.t("common.close")}>
        <DialogTitleGroup
          title={controller.language.t("dialog.model.manage")}
          description={controller.language.t("dialog.model.manage.description")}
        />
        <ButtonV2 variant="neutral" icon="plus" onClick={controller.connectProvider}>
          {controller.language.t("command.provider.connect")}
        </ButtonV2>
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-1 flex-col">
        <div class="px-4 pt-px pb-3">
          <div class="relative">
            <TextInputV2
              type="search"
              appearance="base"
              class="!w-full self-stretch"
              value={controller.list.filter()}
              onInput={(event) => controller.list.onInput(event.currentTarget.value)}
              placeholder={controller.language.t("dialog.model.search.placeholder")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              autofocus
              aria-label={controller.language.t("dialog.model.search.placeholder")}
            />
            <Show when={controller.list.filter()}>
              <IconButtonV2
                type="button"
                variant="ghost-muted"
                size="small"
                class="settings-v2-tab-search-clear"
                icon={<IconV2 name="close" size="large" class="text-v2-icon-icon-muted" />}
                onClick={() => controller.list.clear()}
                aria-label={controller.language.t("common.clear")}
              />
            </Show>
          </div>
        </div>
        <div data-slot="manage-models-scroll" class="relative min-h-0 flex-1">
          <div class="settings-v2-panel settings-v2-models h-full px-4 pt-4 pb-4">
            <Show
              when={!controller.list.grouped.loading}
              fallback={
                <div class="settings-v2-models-status">
                  {controller.language.t("common.loading")}
                  {controller.language.t("common.loading.ellipsis")}
                </div>
              }
            >
              <Show
                when={controller.list.flat().length > 0}
                fallback={
                  <div class="settings-v2-models-status">
                    <span>{controller.language.t("dialog.model.empty")}</span>
                    <Show when={controller.list.filter()}>
                      <span class="settings-v2-models-status-filter">&quot;{controller.list.filter()}&quot;</span>
                    </Show>
                  </div>
                }
              >
                <For each={controller.list.grouped.latest}>
                  {(group) => (
                    <div class="settings-v2-section" data-component="settings-models-provider">
                      <div class="settings-v2-models-group-header justify-between">
                        <div class="flex min-w-0 items-center gap-2">
                          <ProviderIcon id={group.category} width={16} height={16} class="ml-4 shrink-0" />
                          <h3 class="settings-v2-section-title">{group.items[0].provider.name}</h3>
                        </div>
                        <div>
                          <SwitchV2
                            class="mr-6"
                            checked={controller.providerVisible(group.category)}
                            onChange={(checked) => controller.setProviderVisibility(group.category, checked)}
                            hideLabel
                          >
                            {group.items[0].provider.name}
                          </SwitchV2>
                        </div>
                      </div>
                      <SettingsListV2>
                      <For each={group.items}>
                        {(item) => (
                          <SettingsRowV2 title={item.name} description="">
                            <div>
                              <SwitchV2
                                checked={controller.local.model.visible({
                                  modelID: item.id,
                                    providerID: item.provider.id,
                                  })}
                                  onChange={(checked) => controller.setModelVisibility(item, checked)}
                                  hideLabel
                              >
                                {item.name}
                              </SwitchV2>
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
    </DialogV2>
  )
}
