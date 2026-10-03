import { useFilteredList } from "@opencode/ui/hooks"
import { Switch } from "@opencode/ui/switch"
import { type Component, createEffect, createMemo, For, Show } from "solid-js"

import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { useLanguage } from "@/runtime/i18n/language"
import { useModels } from "@/providers/models/models"
import { useServerSDK } from "@/runtime/server/client"
import { popularProviders } from "@/providers/catalog/providers"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { CONSOLE_GROUP_KEY, consoleModelGroup, ProviderModelSections } from "@/providers/models/provider-group"
import { SettingsSearchEmpty } from "@/settings/search-empty"
import { SettingsSearchField } from "@/settings/search-field"

import "@/settings/settings.css"

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]

export const ModelProvidersSchema = Schema.Struct({
  collapsed: Persistence.record(Persistence.fallback(Schema.Boolean, () => false)),
})

export const SettingsModels: Component<{
  active?: boolean
  provider?: string
  onReveal?: () => void
}> = (props) => {
  const language = useLanguage()
  const models = useModels()
  const serverSdk = useServerSDK()
  const [store, setStore] = persisted(
    Persist.serverGlobal(serverSdk.scope, "settings-v2.models.providers"),
    ModelProvidersSchema,
    { collapsed: {} },
  )
  const sections = new Map<string, HTMLElement>()

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
  const managed = createMemo(() => consoleModelGroup(models.list()))
  const searching = () => list.filter().length > 0
  const expanded = (key: string) => searching() || !store.collapsed[key]
  const setProviderVisibility = (providerID: string, visible: boolean) =>
    models.setProviderVisibility(providerID, visible)

  function ModelRows(props: { items: ModelItem[] }) {
    return (
      <SettingsList variant="catalog">
        <For each={props.items}>
          {(item) => {
            const key = { providerID: item.provider.id, modelID: item.id }
            return (
              <SettingsRow title={item.name} description="">
                <div>
                  <Switch
                    checked={models.visible(key)}
                    onChange={(checked) => models.setVisibility(key, checked)}
                    hideLabel
                  >
                    {item.name}
                  </Switch>
                </div>
              </SettingsRow>
            )
          }}
        </For>
      </SettingsList>
    )
  }

  createEffect(() => {
    if (!props.active || !props.provider) return
    const provider = props.provider
    if (list.filter()) {
      list.clear()
      return
    }
    if (!list.grouped.latest.some((group) => group.category === provider)) return
    const section = sections.get(provider)
    if (!section?.isConnected) return
    // Expand only the path to the target so the saved layout of other providers is kept.
    if (managed()?.providers.some((item) => item.id === provider)) setStore("collapsed", CONSOLE_GROUP_KEY, false)
    setStore("collapsed", provider, false)
    requestAnimationFrame(() => {
      const panel = section.closest<HTMLElement>(".settings-panel")
      const header = panel?.querySelector<HTMLElement>(".settings-tab-header")
      if (panel && header) {
        panel.scrollTo({
          top: panel.scrollTop + section.getBoundingClientRect().top - header.getBoundingClientRect().bottom - 24,
        })
      } else {
        section.scrollIntoView({ block: "start" })
      }
      section
        .querySelector<HTMLElement>(".provider-model-group-trigger, .settings-models-group-trigger")
        ?.focus({ preventScroll: true })
      props.onReveal?.()
    })
  })

  return (
    <>
      <div class="settings-tab-header settings-tab-header--stacked">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.models.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.models.description")}</span>
          </div>
        </div>
        <SettingsSearchField
          value={list.filter()}
          active={props.active ?? true}
          onInput={list.onInput}
          placeholder={language.t("dialog.model.search.placeholder")}
        />
      </div>

      <div class="settings-tab-body settings-models">
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
              <Show
                when={list.filter()}
                fallback={<div class="settings-models-status">{language.t("dialog.model.empty")}</div>}
              >
                <div class="settings-tab-search-empty">
                  <SettingsSearchEmpty query={list.filter()} />
                </div>
              </Show>
            }
          >
            <ProviderModelSections
              groups={list.grouped.latest}
              managed={managed()}
              expanded={expanded}
              disabled={searching()}
              onExpandedChange={(key, value) => setStore("collapsed", key, !value)}
              onSetVisibility={setProviderVisibility}
              ref={(providerID, element) => sections.set(providerID, element)}
              rows={(items) => <ModelRows items={items} />}
            />
          </Show>
        </Show>
      </div>
    </>
  )
}
