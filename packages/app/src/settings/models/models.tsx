import { useFilteredList } from "@opencode/ui/hooks"
import { Switch } from "@opencode/ui/switch"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { TextInput } from "@opencode/ui/text-input"
import { type Component, createEffect, createMemo, For, on, onCleanup, Show } from "solid-js"
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
import "@/settings/settings.css"

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]

export const ModelProvidersSchema = Schema.Struct({
  collapsed: Persistence.record(Persistence.fallback(Schema.Boolean, () => false)),
})

export const SettingsModels: Component<{
  active?: boolean
  autofocus?: boolean
  provider?: string
  onReveal?: () => void
}> = (props) => {
  const language = useLanguage()
  const models = useModels()
  const serverSdk = useServerSDK()
  let search: HTMLInputElement | undefined
  createEffect(
    on(
      () => props.active ?? true,
      (active) => {
        if (!active) return
        const frame = requestAnimationFrame(() => {
          if (props.active !== false && props.autofocus !== false && search?.isConnected)
            search.focus({ preventScroll: true })
        })
        onCleanup(() => cancelAnimationFrame(frame))
      },
    ),
  )
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
    models
      .list()
      .filter((item) => item.provider.id === providerID)
      .forEach((item) => models.setVisibility({ providerID, modelID: item.id }, visible))

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
        <div class="settings-tab-search">
          <TextInput
            ref={search}
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
              <div class="settings-models-status">
                <span>{language.t("dialog.model.empty")}</span>
                <Show when={list.filter()}>
                  <span class="settings-models-status-filter">&quot;{list.filter()}&quot;</span>
                </Show>
              </div>
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
