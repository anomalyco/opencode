import { useFilteredList } from "@opencode/ui/hooks"
import { Badge } from "@opencode/ui/badge"
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
import { OpenCodeLogo } from "@/providers/opencode-logo"
import { consoleProviderGroup, consoleProviderName } from "@/providers/catalog/console"
import { ProviderModelGroup, ProviderModelIcon } from "@/providers/models/provider-group"
import "@/settings/settings.css"

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]
type ModelGroup = { category: string; items: ModelItem[] }
type ConsoleGroup = NonNullable<ReturnType<typeof consoleProviderGroup<ModelItem["provider"]>>>
type DisplayGroup =
  | { type: "provider"; group: ModelGroup }
  | { type: "console"; managed: ConsoleGroup; providers: ModelGroup[] }

const CONSOLE_GROUP_KEY = "console:opencode"

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
  const consoleGroup = createMemo(() =>
    consoleProviderGroup([...new Map(models.list().map((item) => [item.provider.id, item.provider])).values()]),
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
    models.list().reduce((counts, item) => {
      if (!models.visible({ providerID: item.provider.id, modelID: item.id })) return counts
      counts.set(item.provider.id, (counts.get(item.provider.id) ?? 0) + 1)
      return counts
    }, new Map<string, number>()),
  )

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
    const managed = consoleGroup()?.providers.some((item) => item.id === provider)
    setStore("collapsed", CONSOLE_GROUP_KEY, Boolean(!managed))
    list.grouped.latest.forEach((group) => setStore("collapsed", group.category, group.category !== provider))
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
            <For each={groups()}>
              {(item) => (
                <Show
                  when={item.type === "console" ? item : undefined}
                  fallback={
                    <Show when={item.type === "provider" ? item.group : undefined}>
                      {(group) => (
                        <div
                          ref={(element) => sections.set(group().category, element)}
                          class="settings-section"
                          data-component="settings-models-provider"
                          data-expanded={expanded(group().category) ? "" : undefined}
                        >
                          <h3 class="settings-models-group-header">
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
                                <ProviderModelIcon
                                  provider={group().items[0].provider}
                                  class="settings-models-provider-icon shrink-0"
                                />
                                <bdi class="settings-models-group-title">{providerName(group().items[0].provider)}</bdi>
                              </span>
                            </button>
                          </h3>
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
                      data-component="settings-models-console"
                      data-expanded={expanded(CONSOLE_GROUP_KEY) ? "" : undefined}
                    >
                      <h3 class="settings-models-group-header">
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
                      </h3>
                      <Show when={expanded(CONSOLE_GROUP_KEY)}>
                        <div class="provider-model-groups settings-models-console-groups">
                          <For each={console().providers}>
                            {(group) => {
                              const count = () => enabled().get(group.category) ?? 0
                              return (
                                <ProviderModelGroup
                                  ref={(element) => sections.set(group.category, element)}
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
    </>
  )
}
