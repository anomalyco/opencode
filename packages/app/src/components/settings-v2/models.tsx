import { TablerIcon } from "@opencode-ai/ui/tabler-icon"
import { useFilteredList } from "@opencode-ai/ui/hooks"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { type Component, createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useServerSDK } from "@/context/server-sdk"
import { popularProviders } from "@/hooks/use-providers"
import { Persist, persisted } from "@/utils/persist"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { VoiceModelsSettings } from "./voice"
import { OllamaModelsProvider, useOllamaModels } from "./ollama"
import { ollamaTagKey } from "@/ollama/types"
import "./settings-v2.css"

type ModelItem = { id: string; name: string; provider: { id: string; name: string }; registered: boolean }

const PROVIDER_ICON_SIZE = 16

export const SettingsModelsV2: Component = () => {
  const language = useLanguage()
  const [state, setState] = createStore({ tab: "chat" })
  return (
    <OllamaModelsProvider tab={state.tab}>
      <div class="settings-v2-tab-header settings-v2-tab-header--stacked">
        <h2 class="settings-v2-tab-title">{language.t("settings.models.title")}</h2>
        <div class="voice-settings-tabs" role="tablist" aria-label={language.t("settings.models.title")}>
          <ButtonV2
            role="tab"
            aria-selected={state.tab === "chat"}
            variant={state.tab === "chat" ? "neutral" : "ghost-muted"}
            onClick={() => setState("tab", "chat")}
          >
            {language.t("voice.models.chat")}
          </ButtonV2>
          <ButtonV2
            role="tab"
            aria-selected={state.tab === "voice"}
            variant={state.tab === "voice" ? "neutral" : "ghost-muted"}
            onClick={() => setState("tab", "voice")}
          >
            {language.t("voice.models.voice")}
          </ButtonV2>
        </div>
      </div>
      <Show when={state.tab === "voice"} fallback={<SettingsChatModelsV2 />}>
        <VoiceModelsSettings />
      </Show>
    </OllamaModelsProvider>
  )
}

const SettingsChatModelsV2: Component = () => {
  const manager = useOllamaModels()
  const isOllama = (id: string) => manager.connections().some((provider) => provider.id === id)
  const language = useLanguage()
  const models = useModels()
  const serverSdk = useServerSDK()
  const [store, setStore] = persisted(
    Persist.serverGlobal(serverSdk().scope, "settings-v2.models.providers"),
    createStore({ collapsed: {} as Record<string, boolean> }),
  )

  const items = createMemo<ModelItem[]>(() => [
    ...models
      .list()
      .filter((model) => !isOllama(model.provider.id))
      .map((model) => ({ ...model, registered: true })),
    ...manager.connections().flatMap<ModelItem>((provider) => {
      const registered = models.list().filter((model) => model.provider.id === provider.id)
      const installed = manager.state.inventory[provider.id]
      if (!installed) return registered.map((model) => ({ ...model, registered: true }))
      return installed.flatMap((model) => {
        const saved = registered.find((item) => ollamaTagKey(item.id) === ollamaTagKey(model.name))
        if (!saved && manager.isVoice(provider.id, model.name)) return []
        return [{ id: saved?.id ?? model.name, name: saved?.name ?? model.name, provider, registered: !!saved }]
      })
    }),
  ])
  const list = useFilteredList<ModelItem>({
    items: (_filter) => items(),
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
    <>
      <div class="settings-v2-tab-header settings-v2-tab-header--stacked">
        <div class="settings-v2-tab-search">
          <TextInputV2
            type="search"
            appearance="base"
            value={list.filter()}
            onInput={(event) => list.onInput(event.currentTarget.value)}
            placeholder={language.t("dialog.model.search.placeholder")}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            aria-label={language.t("dialog.model.search.placeholder")}
          />
          <Show when={list.filter()}>
            <IconButtonV2
              type="button"
              variant="ghost-muted"
              size="small"
              class="settings-v2-tab-search-clear"
              icon={<IconV2 name="close" size="large" class="text-v2-icon-icon-muted" />}
              onClick={() => list.clear()}
            />
          </Show>
        </div>
      </div>

      <div class="settings-v2-tab-body settings-v2-models">
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
              {(group) => {
                const searching = () => list.filter().length > 0
                const expanded = () => searching() || !store.collapsed[group.category]

                return (
                  <div
                    class="settings-v2-section"
                    data-component="settings-models-provider"
                    data-provider={group.category}
                    data-expanded={expanded() ? "" : undefined}
                  >
                    <h3
                      class="settings-v2-models-group-header"
                      classList={{ "settings-v2-models-group-header--managed": isOllama(group.category) }}
                    >
                      <button
                        type="button"
                        class="settings-v2-models-group-trigger"
                        aria-expanded={expanded()}
                        disabled={searching()}
                        onClick={() => setStore("collapsed", group.category, expanded())}
                      >
                        <span class="settings-v2-models-group-chevron">
                          <Show
                            when={expanded()}
                            fallback={<TablerIcon name="chevron-right" width="16" height="16" aria-hidden="true" />}
                          >
                            <TablerIcon name="chevron-down" width="16" height="16" aria-hidden="true" />
                          </Show>
                        </span>
                        <span class="settings-v2-models-group-label">
                          <ProviderIcon
                            id={group.category}
                            width={PROVIDER_ICON_SIZE}
                            height={PROVIDER_ICON_SIZE}
                            class="settings-v2-models-provider-icon shrink-0"
                          />
                          <span class="settings-v2-section-title">{group.items[0].provider.name}</span>
                        </span>
                      </button>
                      <Show when={isOllama(group.category)}>
                        <manager.Trigger providerID={group.category} />
                      </Show>
                    </h3>
                    <manager.Panel providerID={group.category} />
                    <Show when={expanded()}>
                      <SettingsListV2>
                        <For each={group.items}>
                          {(item) => {
                            const key = { providerID: item.provider.id, modelID: item.id }
                            return (
                              <div data-component="ollama-model-row" data-model={item.id}>
                                <SettingsRowV2 title={item.name} description="">
                                  <div class="voice-settings-actions">
                                    <Show when={isOllama(item.provider.id)}>
                                      <ButtonV2
                                        size="small"
                                        variant={
                                          manager.modelOpen(item.provider.id, item.id) ? "neutral" : "ghost-muted"
                                        }
                                        aria-expanded={manager.modelOpen(item.provider.id, item.id)}
                                        disabled={manager.state.busy}
                                        onClick={() => manager.toggleModel(item.provider.id, item.id)}
                                      >
                                        {language.t("models.manage.edit")}
                                      </ButtonV2>
                                    </Show>
                                    <Switch
                                      checked={
                                        (item.registered ||
                                          manager.state.registered[`${item.provider.id}/${ollamaTagKey(item.id)}`]) &&
                                        models.visible(key)
                                      }
                                      disabled={manager.state.busy}
                                      onChange={async (checked) => {
                                        if (
                                          checked &&
                                          !item.registered &&
                                          !manager.state.registered[`${item.provider.id}/${ollamaTagKey(item.id)}`] &&
                                          !(await manager.enable(item.provider.id, item.id, "chat"))
                                        )
                                          return
                                        models.setVisibility(key, checked)
                                      }}
                                      hideLabel
                                    >
                                      {item.name}
                                    </Switch>
                                  </div>
                                </SettingsRowV2>
                                <manager.Editor providerID={item.provider.id} modelID={item.id} />
                              </div>
                            )
                          }}
                        </For>
                      </SettingsListV2>
                    </Show>
                  </div>
                )
              }}
            </For>
          </Show>
        </Show>
        <For
          each={manager.connections().filter((provider) => !items().some((item) => item.provider.id === provider.id))}
        >
          {(provider) => (
            <section class="settings-v2-section" data-component="settings-models-provider" data-provider={provider.id}>
              <h3 class="settings-v2-models-group-header settings-v2-models-group-header--managed">
                <span class="settings-v2-section-title">{provider.name}</span>
                <manager.Trigger providerID={provider.id} />
              </h3>
              <manager.Panel providerID={provider.id} />
            </section>
          )}
        </For>
      </div>
    </>
  )
}
