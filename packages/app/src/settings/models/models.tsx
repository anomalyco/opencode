import { useFilteredList } from "@opencode/ui/hooks"
import { Switch } from "@opencode/ui/switch"
import { type Component, batch, createEffect, createMemo, For, onCleanup, Show } from "solid-js"

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
  const drag = {
    current: undefined as
      | {
          id: number
          source: HTMLElement
          rows: HTMLElement[]
          positions: Map<HTMLElement, number>
          initial: boolean[]
          start: number
          index: number
          checked: boolean
          panel: HTMLElement
          header: HTMLElement | null
          x: number
          y: number
          changed: boolean
        }
      | undefined,
    frame: 0,
    suppress: undefined as { source: HTMLElement } | undefined,
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
  const managed = createMemo(() => consoleModelGroup(models.list()))
  const searching = () => list.filter().length > 0
  const expanded = (key: string) => searching() || !store.collapsed[key]
  const setProviderVisibility = (providerID: string, visible: boolean) =>
    models
      .list()
      .filter((item) => item.provider.id === providerID)
      .forEach((item) => models.setVisibility({ providerID, modelID: item.id }, visible))

  function paint() {
    const current = drag.current
    if (!current) return
    const bounds = current.panel.getBoundingClientRect()
    if (current.x < bounds.left || current.x > bounds.right) return
    const top = current.header?.getBoundingClientRect().bottom ?? bounds.top
    const target = document
      .elementFromPoint(current.x, Math.max(top + 1, Math.min(bounds.bottom - 1, current.y)))
      ?.closest<HTMLElement>('[data-component="settings-row"]')
      ?.querySelector<HTMLElement>("[data-model-id]")
    const index = target ? current.positions.get(target) : undefined
    if (index === undefined || index === current.index) return
    const before = [Math.min(current.start, current.index), Math.max(current.start, current.index)]
    const after = [Math.min(current.start, index), Math.max(current.start, index)]
    batch(() => {
      for (let position = Math.min(before[0], after[0]); position <= Math.max(before[1], after[1]); position++) {
        const was = position >= before[0] && position <= before[1]
        const now = position >= after[0] && position <= after[1]
        if (was === now && (position !== current.start || current.changed)) continue
        const row = current.rows[position]
        const key = { providerID: row.dataset.modelProvider!, modelID: row.dataset.modelId! }
        const checked = now ? current.checked : current.initial[position]
        if (models.visible(key) !== checked) models.setVisibility(key, checked)
      }
    })
    current.index = index
    current.changed = true
  }

  function scroll() {
    drag.frame = 0
    const current = drag.current
    if (!current) return
    const bounds = current.panel.getBoundingClientRect()
    if (current.x < bounds.left || current.x > bounds.right) return
    const top = current.header?.getBoundingClientRect().bottom ?? bounds.top
    const edge = 36
    const speed =
      current.y < top + edge
        ? -Math.min(18, Math.max(0, top + edge - current.y) / 2)
        : Math.min(18, Math.max(0, current.y - (bounds.bottom - edge)) / 2)
    if (!speed) return
    const previous = current.panel.scrollTop
    current.panel.scrollTop += speed
    if (current.panel.scrollTop === previous) return
    paint()
    drag.frame = requestAnimationFrame(scroll)
  }

  function move(event: PointerEvent) {
    const current = drag.current
    if (!current || event.pointerId !== current.id) return
    current.x = event.clientX
    current.y = event.clientY
    paint()
    if (drag.frame) return
    drag.frame = requestAnimationFrame(scroll)
  }

  function end(event?: PointerEvent) {
    const current = drag.current
    if (!current || (event && event.pointerId !== current.id)) return
    if (event?.type === "pointerup") {
      if (!current.changed) {
        const key = { providerID: current.source.dataset.modelProvider!, modelID: current.source.dataset.modelId! }
        if (models.visible(key) !== current.checked) models.setVisibility(key, current.checked)
      }
      const click = drag.suppress
      setTimeout(() => {
        if (drag.suppress !== click) return
        click?.source.removeEventListener("click", suppress, true)
        drag.suppress = undefined
      }, 400)
    } else {
      if (current.changed) {
        batch(() => {
          for (
            let position = Math.min(current.start, current.index);
            position <= Math.max(current.start, current.index);
            position++
          ) {
            const row = current.rows[position]
            const key = { providerID: row.dataset.modelProvider!, modelID: row.dataset.modelId! }
            if (models.visible(key) !== current.initial[position]) models.setVisibility(key, current.initial[position])
          }
        })
      }
      current.source.removeEventListener("click", suppress, true)
      drag.suppress = undefined
    }
    drag.current = undefined
    cancelAnimationFrame(drag.frame)
    drag.frame = 0
    document.removeEventListener("pointermove", move)
    document.removeEventListener("pointerup", end)
    document.removeEventListener("pointercancel", end)
    current.panel.removeEventListener("scroll", paint)
    window.removeEventListener("blur", blur)
  }

  function blur() {
    end()
  }

  function suppress(event: MouseEvent) {
    if (drag.suppress?.source !== event.currentTarget) return
    event.preventDefault()
    event.stopImmediatePropagation()
    drag.suppress.source.removeEventListener("click", suppress, true)
    drag.suppress = undefined
  }

  function start(event: PointerEvent & { currentTarget: HTMLElement }) {
    if (!event.isPrimary || event.button !== 0 || drag.current) return
    const panel = event.currentTarget.closest<HTMLElement>(".settings-panel")
    if (!panel) return
    const rows = Array.from(panel.querySelectorAll<HTMLElement>(".settings-models [data-model-id]"))
    const index = rows.indexOf(event.currentTarget)
    if (index < 0) return
    drag.suppress?.source.removeEventListener("click", suppress, true)
    drag.suppress = { source: event.currentTarget }
    drag.suppress.source.addEventListener("click", suppress, true)
    const key = {
      providerID: event.currentTarget.dataset.modelProvider!,
      modelID: event.currentTarget.dataset.modelId!,
    }
    drag.current = {
      id: event.pointerId,
      source: event.currentTarget,
      rows,
      positions: new Map(rows.map((row, index) => [row, index])),
      initial: rows.map((row) =>
        models.visible({ providerID: row.dataset.modelProvider!, modelID: row.dataset.modelId! }),
      ),
      start: index,
      index,
      checked: !models.visible(key),
      panel,
      header: panel.querySelector<HTMLElement>(".settings-tab-header"),
      x: event.clientX,
      y: event.clientY,
      changed: false,
    }
    document.addEventListener("pointermove", move)
    document.addEventListener("pointerup", end)
    document.addEventListener("pointercancel", end)
    panel.addEventListener("scroll", paint, { passive: true })
    window.addEventListener("blur", blur)
  }

  onCleanup(() => {
    end()
    drag.suppress?.source.removeEventListener("click", suppress, true)
  })

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
                    data-model-provider={key.providerID}
                    data-model-id={key.modelID}
                    checked={models.visible(key)}
                    onChange={(checked) => models.setVisibility(key, checked)}
                    onPointerDown={start}
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
