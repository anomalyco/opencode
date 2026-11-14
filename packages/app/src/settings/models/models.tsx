import { useFilteredList } from "@opencode/ui/hooks"
import { Switch } from "@opencode/ui/switch"
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
  untrack,
} from "solid-js"

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
import { settingsScroller } from "@/settings/scroller"
import {
  createModelsRevealState,
  revealingModelProvider,
  transitionModelsReveal,
  type ModelsRevealEvent,
} from "./machine"

import "@/settings/settings.css"

type ModelItem = ReturnType<ReturnType<typeof useModels>["list"]>[number]

export const ModelProvidersSchema = Schema.Struct({
  collapsed: Persistence.record(Persistence.fallback(Schema.Boolean, () => false)),
})

export const SettingsModels: Component<{
  active?: boolean
  /** A provider to reveal, picked on the Providers page. */
  provider?: string
  /** The reveal of `provider` ended: it was shown, gave up, or the user moved on. */
  onConsumeTarget?: () => void
  headerAction?: JSX.Element
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

  const [reveal, setReveal] = createSignal(createModelsRevealState())
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  let revealFrame: number | undefined

  const dispatch = (event: ModelsRevealEvent): void =>
    untrack(() => {
      const result = transitionModelsReveal(reveal(), event)
      setReveal(result.state)
      result.effects.forEach((effect) => {
        if (effect.type === "filter.clear") return list.clear()

        // Expand only the path to the target so the saved layout of other providers is kept.
        if (effect.type === "section.expand") {
          if (effect.expandConsole) setStore("collapsed", CONSOLE_GROUP_KEY, false)
          setStore("collapsed", effect.provider, false)

          return
        }

        if (effect.type === "timeout.start") {
          revealTimer = setTimeout(
            () => dispatch({ type: "reveal.timed-out", attempt: effect.attempt }),
            effect.timeoutMs,
          )

          return
        }

        if (effect.type === "timeout.cancel") {
          clearTimeout(revealTimer)
          revealTimer = undefined

          return
        }

        if (effect.type === "frame.cancel") {
          if (revealFrame !== undefined) cancelAnimationFrame(revealFrame)
          revealFrame = undefined

          return
        }

        if (effect.type === "target.consume") return props.onConsumeTarget?.()

        revealFrame = requestAnimationFrame(() => {
          revealFrame = undefined
          scrollToSection(sections.get(effect.provider))
          dispatch({ type: "frame.completed", attempt: effect.attempt })
        })
      })
    })

  createEffect(() =>
    dispatch({
      type: "target.synced",
      active: !!props.active,
      provider: props.provider,
      hasFilter: untrack(() => !!list.filter()),
    }),
  )

  // Checks the catalog only while a reveal looks for its provider.
  createEffect(() => {
    const provider = revealingModelProvider(reveal())

    if (!provider) return

    dispatch({
      type: "catalog.synced",
      hasFilter: !!list.filter(),
      inCatalog: list.grouped.latest.some((group) => group.category === provider),
      inConsoleGroup: !!managed()?.providers.some((item) => item.id === provider),
      sectionReady: !!sections.get(provider)?.isConnected,
    })
  })

  onCleanup(() => dispatch({ type: "disposed" }))

  return (
    <>
      <div class="settings-tab-header settings-tab-header--stacked">
        <div class="settings-tab-header-row">
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.models.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.models.description")}</span>
          </div>
          <div class="settings-tab-header-actions">{props.headerAction}</div>
        </div>
        <SettingsSearchField
          value={list.filter()}
          active={props.active ?? true}
          onInput={(value) => {
            dispatch({ type: "filter.typed" })
            list.onInput(value)
          }}
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
              ref={(providerID, element) => {
                sections.set(providerID, element)
                // A ref runs before the section joins the document.
                queueMicrotask(() => {
                  if (element.isConnected) dispatch({ type: "section.ready", provider: providerID })
                })
              }}
              rows={(items) => <ModelRows items={items} />}
            />
          </Show>
        </Show>
      </div>
    </>
  )
}

function scrollToSection(section: HTMLElement | undefined) {
  if (!section?.isConnected) return
  const panel = section.closest<HTMLElement>(".settings-panel")
  const header = panel?.querySelector<HTMLElement>(".settings-tab-header")

  if (panel && header) {
    settingsScroller(panel).scrollBy({
      top: section.getBoundingClientRect().top - header.getBoundingClientRect().bottom - 24,
    })
  } else {
    section.scrollIntoView({ block: "start" })
  }

  section
    .querySelector<HTMLElement>(".provider-model-group-trigger, .settings-models-group-trigger")
    ?.focus({ preventScroll: true })
}
