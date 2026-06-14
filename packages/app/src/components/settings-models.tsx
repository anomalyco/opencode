import type { Config } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { useFilteredList } from "@opencode-ai/ui/hooks"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Switch } from "@opencode-ai/ui/switch"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo, type Component, For, type JSX, Show } from "solid-js"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { popularProviders, useProviders } from "@/hooks/use-providers"
import { ModelSelectorPopover } from "./dialog-select-model"
import { SettingsList } from "./settings-list"
import { SettingsServerPicker, SettingsServerScope } from "./settings-server-picker"

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]
type ModelKey = { providerID: string; modelID: string }

function parseConfigModel(value: string | undefined) {
  if (!value) return
  const [providerID, ...rest] = value.split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) return
  return { providerID, modelID }
}

const ListLoadingState: Component<{ label: string }> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <span class="text-14-regular text-text-weak">{props.label}</span>
    </div>
  )
}

const ListEmptyState: Component<{ message: string; filter: string }> = (props) => {
  return (
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <span class="text-14-regular text-text-weak">{props.message}</span>
      <Show when={props.filter}>
        <span class="text-14-regular text-text-strong mt-1">&quot;{props.filter}&quot;</span>
      </Show>
    </div>
  )
}

export const SettingsModels: Component = () => {
  return (
    <SettingsServerScope>
      <SettingsModelsContent />
    </SettingsServerScope>
  )
}

const SettingsModelsContent: Component = () => {
  const language = useLanguage()
  const serverSync = useServerSync()
  const models = useModels()
  const providers = useProviders()

  const handleConfigError = (err: unknown, rollback: () => void) => {
    rollback()
    showToast({
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })
  }

  const updateConfig = (config: Config, rollback: () => void) => {
    void serverSync().updateConfig(config).catch((err: unknown) => handleConfigError(err, rollback))
  }

  const configuredDefaultModel = createMemo(() => {
    const model = parseConfigModel(serverSync().data.config.model)
    if (!model) return
    return models.find(model)
  })

  const currentDefaultModel = createMemo(() => {
    const configured = configuredDefaultModel()
    if (configured) return configured

    const defaults = providers.default()
    for (const provider of providers.connected()) {
      const configuredModel = defaults[provider.id]
      const found = configuredModel ? models.find({ providerID: provider.id, modelID: configuredModel }) : undefined
      if (found) return found

      const first = Object.values(provider.models)[0]
      if (!first) continue
      const fallback = models.find({ providerID: provider.id, modelID: first.id })
      if (fallback) return fallback
    }
  })

  const setDefaultModel = (model: ModelKey | undefined, options?: { recent?: boolean }) => {
    if (!model) return
    const before = serverSync().data.config.model
    const next = `${model.providerID}/${model.modelID}`
    serverSync().set("config", "model", next)
    models.setVisibility(model, true)
    if (options?.recent) models.recent.push(model)
    updateConfig({ model: next }, () => serverSync().set("config", "model", before))
  }

  const defaultModelState = {
    current: currentDefaultModel,
    list: models.list,
    set: setDefaultModel,
    visible: models.visible,
  }

  const list = useFilteredList<ModelItem>({
    items: (_filter) => models.list(),
    key: (x) => `${x.provider.id}:${x.id}`,
    filterKeys: ["provider.name", "name", "id"],
    sortBy: (a, b) => a.name.localeCompare(b.name),
    groupBy: (x) => x.provider.id,
    sortGroupsBy: (a, b) => {
      const aIndex = popularProviders.indexOf(a.category)
      const bIndex = popularProviders.indexOf(b.category)
      const aPopular = aIndex >= 0
      const bPopular = bIndex >= 0

      if (aPopular && !bPopular) return -1
      if (!aPopular && bPopular) return 1
      if (aPopular && bPopular) return aIndex - bIndex

      const aName = a.items[0].provider.name
      const bName = b.items[0].provider.name
      return aName.localeCompare(bName)
    },
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-4 pt-6 pb-6 max-w-[720px]">
          <div class="flex items-center justify-between gap-4">
            <h2 class="text-16-medium text-text-strong">{language.t("settings.models.title")}</h2>
            <SettingsServerPicker />
          </div>
          <div class="flex items-center gap-2 px-3 h-9 rounded-lg bg-surface-base">
            <Icon name="magnifying-glass" class="text-icon-weak-base flex-shrink-0" />
            <TextField
              variant="ghost"
              type="text"
              value={list.filter()}
              onChange={list.onInput}
              placeholder={language.t("dialog.model.search.placeholder")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="flex-1"
            />
            <Show when={list.filter()}>
              <IconButton icon="circle-x" variant="ghost" onClick={list.clear} />
            </Show>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.models.section.defaults")}</h3>
          <SettingsList>
            <SettingsRow
              title={language.t("settings.models.defaultModel.title")}
              description={language.t("settings.models.defaultModel.description")}
            >
              <ModelSelectorPopover
                model={defaultModelState}
                triggerAs={Button}
                triggerProps={{
                  variant: "secondary",
                  size: "small",
                  class: "min-w-0 max-w-[260px] text-12-regular text-text-base group",
                  "data-action": "settings-default-model",
                }}
              >
                <Show when={currentDefaultModel()?.provider.id}>
                  <ProviderIcon
                    id={currentDefaultModel()?.provider.id ?? ""}
                    class="size-4 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity duration-150"
                  />
                </Show>
                <span class="truncate">
                  {currentDefaultModel()?.name ?? language.t("settings.models.defaultModel.empty")}
                </span>
                <Icon name="chevron-down" size="small" class="shrink-0" />
              </ModelSelectorPopover>
            </SettingsRow>
          </SettingsList>
        </div>

        <Show
          when={!list.grouped.loading}
          fallback={
            <ListLoadingState label={`${language.t("common.loading")}${language.t("common.loading.ellipsis")}`} />
          }
        >
          <Show
            when={list.flat().length > 0}
            fallback={<ListEmptyState message={language.t("dialog.model.empty")} filter={list.filter()} />}
          >
            <For each={list.grouped.latest}>
              {(group) => (
                <div class="flex flex-col gap-1">
                  <div class="flex items-center gap-2 pb-2">
                    <ProviderIcon id={group.category} class="size-5 shrink-0 icon-strong-base" />
                    <span class="text-14-medium text-text-strong">{group.items[0].provider.name}</span>
                  </div>
                  <SettingsList>
                    <For each={group.items}>
                      {(item) => {
                        const key = { providerID: item.provider.id, modelID: item.id }
                        return (
                          <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
                            <div class="min-w-0">
                              <span class="text-14-regular text-text-strong truncate block">{item.name}</span>
                            </div>
                            <div class="flex-shrink-0">
                              <Switch
                                checked={models.visible(key)}
                                onChange={(checked) => {
                                  models.setVisibility(key, checked)
                                }}
                                hideLabel
                              >
                                {item.name}
                              </Switch>
                            </div>
                          </div>
                        )
                      }}
                    </For>
                  </SettingsList>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  )
}

const SettingsRow: Component<{ title: string; description: string; children: JSX.Element }> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}
