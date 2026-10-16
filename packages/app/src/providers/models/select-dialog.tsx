import { Popover } from "@kobalte/core/popover"
import {
  Component,
  ComponentProps,
  createEffect,
  createMemo,
  For,
  JSX,
  Show,
  Suspense,
  lazy,
  on,
  onCleanup,
} from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal, type ModelSelection } from "@/providers/models/selection"
import { useDialog } from "@opencode/ui/context/dialog"
import { popularProviders } from "@/providers/catalog/providers"
import { Button } from "@opencode/ui/button"
import { Badge } from "@opencode/ui/badge"
import { Dialog, DialogBody, DialogTitle } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Tooltip } from "@opencode/ui/tooltip"
import { TextInput } from "@opencode/ui/text-input"
import { ModelTooltip } from "./tooltip"
import { ModelDetails } from "./details"
import { useLanguage } from "@/runtime/i18n/language"
import { ExternalLink } from "@/runtime/platform/external-link"
import { useData } from "@/runtime/server/current"
import { useWorkspaceLocation } from "@/workspaces/location"
import { createSafeTriangle } from "@/shell/commands/safe-triangle"
import { createEventListener } from "@solid-primitives/event-listener"
import { matchesModelSearch } from "./search"
import { SettingsList } from "@/settings/list"
import {
  CONSOLE_GROUP_KEY,
  consoleModelGroup,
  ProviderModelIcon,
  ProviderModelSections,
} from "@/providers/models/provider-group"
import { consoleProviderName } from "@/providers/catalog/console"
import "@/settings/settings.css"
import "@/shell/commands/dialog.css"
import "./select-dialog.css"

const MobilePanelDrawer = lazy(async () => {
  const { MobilePanelDrawer } = await import("@/shell/mobile-panel-drawer")

  return { default: MobilePanelDrawer }
})

const isFree = (provider: string, cost: { input: number } | undefined) =>
  provider === "opencode" && (!cost || cost.input === 0)

type ModelState = ModelSelection

type ModelItem = ReturnType<ModelState["list"]>[number]

const modelKey = (model: ModelItem) => `${model.provider.id}:${model.id}`

const sortModelGroups = (a: { category: string; items: ModelItem[] }, b: { category: string; items: ModelItem[] }) => {
  const aIndex = popularProviders.indexOf(a.category)
  const bIndex = popularProviders.indexOf(b.category)
  const aPopular = aIndex >= 0
  const bPopular = bIndex >= 0

  if (aPopular && !bPopular) return -1

  if (!aPopular && bPopular) return 1

  if (aPopular && bPopular) return aIndex - bIndex

  return a.items[0].provider.name.localeCompare(b.items[0].provider.name)
}

const ModelList: Component<{
  mobile?: boolean
  open?: boolean
  provider?: string
  onSelect: () => void
  model?: ModelState
}> = (props) => {
  const language = useLanguage()

  const controller = createModelSelectorController({
    model: props.model,
    provider: () => props.provider,
    onSelect: props.onSelect,
  })

  const [store, setStore] = createStore<{
    search: string
    active: string
    collapsed: Record<string, boolean>
  }>({
    search: "",
    active: props.mobile ? (controller.current() ?? "") : "",
    collapsed: {},
  })

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!props.mobile || !open) return
        setStore({ search: "", active: controller.current() ?? "" })
      },
    ),
  )
  const models = createMemo(() => controller.models(store.search))
  const modelGroups = createMemo(() => controller.groups(models()))
  const managed = createMemo(() => consoleModelGroup(controller.all()))
  const expanded = (provider: string) => store.search.length > 0 || !store.collapsed[provider]
  const managedIDs = createMemo(() => new Set(managed()?.providers.map((provider) => provider.id) ?? []))

  const visibleModels = () =>
    models().filter(
      (item) => expanded(item.provider.id) && (!managedIDs().has(item.provider.id) || expanded(CONSOLE_GROUP_KEY)),
    )

  let scrollRef: HTMLDivElement | undefined

  const setSearch = (value: string) => {
    const first = controller.models(value).find((item) => value.length > 0 || !store.collapsed[item.provider.id])
    setStore({ search: value, active: first ? modelKey(first) : "" })
  }

  const moveActive = (delta: number) => {
    const keys = visibleModels().map(modelKey)

    if (keys.length === 0) return
    const index = keys.indexOf(store.active)
    const start = index === -1 ? (delta > 0 ? -1 : 0) : index
    setStore("active", keys[(start + delta + keys.length) % keys.length])
    queueMicrotask(() => {
      scrollRef
        ?.querySelector<HTMLElement>(`[data-option-key="${CSS.escape(store.active)}"]`)
        ?.scrollIntoView({ block: "nearest" })
    })
  }

  const selectActive = () => {
    const item = visibleModels().find((item) => modelKey(item) === store.active)

    if (item) controller.select(item)
  }

  function ModelRows(props: { items: ModelItem[]; mobile?: boolean }) {
    return (
      <SettingsList variant="catalog">
        <For each={props.items}>
          {(item) => (
            <button
              type="button"
              data-component="settings-row"
              data-option-key={modelKey(item)}
              aria-pressed={controller.current() === modelKey(item)}
              class="-mx-4 w-[calc(100%+32px)] px-4 text-start first:rounded-t-lg last:rounded-b-lg hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
              classList={{ "bg-v2-overlay-simple-overlay-hover": store.active === modelKey(item) }}
              onMouseEnter={() => setStore("active", modelKey(item))}
              onMouseLeave={() => setStore("active", "")}
              onClick={() => controller.select(item)}
            >
              <div data-slot="settings-row-copy">
                <div data-slot="settings-row-title" class="flex items-center gap-2">
                  <Tooltip
                    inactive={props.mobile}
                    placement="right-start"
                    gutter={12}
                    openDelay={0}
                    value={
                      <ModelTooltip model={item} latest={item.latest} free={isFree(item.provider.id, item.cost)} v2 />
                    }
                  >
                    <span class="min-w-0 truncate">{item.name}</span>
                  </Tooltip>
                  <Show when={isFree(item.provider.id, item.cost)}>
                    <Badge class="shrink-0">{language.t("model.tag.free")}</Badge>
                  </Show>
                  <Show when={item.latest}>
                    <Badge class="shrink-0">{language.t("model.tag.latest")}</Badge>
                  </Show>
                </div>
              </div>
              <div data-slot="settings-row-control" class="size-4">
                <Show when={controller.current() === modelKey(item)}>
                  <Icon name="check" size="small" class="shrink-0 text-v2-icon-icon-base" />
                </Show>
              </div>
            </button>
          )}
        </For>
      </SettingsList>
    )
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div data-slot="model-selector-search" class="shrink-0 pt-px pb-3" classList={{ "px-4": !props.mobile }}>
        <TextInput
          type="search"
          appearance="base"
          class="!w-full self-stretch"
          placeholder={language.t("dialog.model.search.placeholder")}
          value={store.search}
          autofocus={!props.mobile}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
          onInput={(event) => setSearch(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.altKey || event.metaKey) return

            if (event.key === "ArrowDown") {
              event.preventDefault()
              moveActive(1)

              return
            }

            if (event.key === "ArrowUp") {
              event.preventDefault()
              moveActive(-1)

              return
            }

            if (event.key === "Enter" && !event.isComposing) {
              event.preventDefault()
              selectActive()
            }
          }}
          aria-label={language.t("dialog.model.search.placeholder")}
          showClearButton={!!store.search}
          clearIcon="circle-xmark"
          clearLabel={language.t("common.clear")}
          onClearClick={() => setSearch("")}
        />
      </div>
      <div class="relative min-h-0" classList={{ "flex-1": !props.mobile }}>
        <div
          ref={(element) => (scrollRef = element)}
          class="settings-panel settings-models pt-1 pb-4"
          classList={{ "h-full px-4": !props.mobile, "max-h-[min(360px,40dvh)]": props.mobile }}
        >
          <Show
            when={models().length > 0}
            fallback={<div class="settings-models-status">{language.t("dialog.model.empty")}</div>}
          >
            <ProviderModelSections
              groups={modelGroups()}
              managed={managed()}
              expanded={expanded}
              disabled={store.search.length > 0}
              onExpandedChange={(key, value) => setStore("collapsed", key, !value)}
              rows={(items) => <ModelRows items={items} mobile={props.mobile} />}
            />
          </Show>
        </div>
      </div>
    </div>
  )
}

type ModelSelectorTriggerProps = Omit<ComponentProps<typeof Popover.Trigger>, "as" | "ref">

type ModelSelectorTrigger = (props: ModelSelectorTriggerProps) => JSX.Element

// Phones pick models from a drawer; wider screens use DialogSelectModel.
export function ModelSelectorDrawer(props: {
  provider?: string
  model?: ModelState
  unpaid?: boolean
  trigger: ModelSelectorTrigger
  onClose?: () => void
}) {
  const dialog = useDialog()
  const location = useWorkspaceLocation()

  const controller = createModelSelectorController({
    model: props.model,
    provider: () => props.provider,
    onSelect: () => props.onClose?.(),
  })

  const chatgptPlan = createChatgptPlan(controller.current)

  const manage = async () => {
    const { DialogManageModels } = await import("./manage")
    void dialog.show(() => <DialogManageModels />)
  }

  const connect = async () => {
    const { DialogConnectProvider } = await import("@/providers/connect/dialog")
    void dialog.show(() => <DialogConnectProvider directory={location().directory} />)
  }

  return (
    <ModelDrawer
      trigger={props.trigger}
      onManage={manage}
      model={props.model}
      provider={props.provider}
      onConnect={props.unpaid ? connect : undefined}
      chatgptPlan={chatgptPlan()}
      onClose={() => props.onClose?.()}
    />
  )
}

function ModelDrawer(props: {
  trigger: ModelSelectorTrigger
  model?: ModelState
  provider?: string
  chatgptPlan?: boolean
  onClose: () => void
  onManage: () => void
  onConnect?: () => void
}) {
  const language = useLanguage()

  const [store, setStore] = createStore<{
    open: boolean
    loaded: boolean
    restoreTrigger: boolean
    action?: "select" | "manage" | "connect"
  }>({
    open: false,
    loaded: false,
    restoreTrigger: true,
  })

  let trigger: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined

  return (
    <>
      <div ref={trigger} class="min-w-0">
        {props.trigger({
          "aria-haspopup": "dialog",
          get "aria-expanded"() {
            return store.open
          },
          onClick: () => setStore({ open: true, loaded: true, restoreTrigger: true }),
        })}
      </div>
      <Show when={store.loaded}>
        <Suspense>
          <MobilePanelDrawer
            hideHeader
            title={language.t("dialog.model.select.title")}
            open={store.open}
            onOpenChange={(open) => setStore("open", open)}
            initialFocus={() => content}
            returnFocus={() => trigger?.querySelector("button") ?? undefined}
            onFinalFocus={(event) => {
              if (!store.restoreTrigger) event.preventDefault()
            }}
            onContentPresentChange={(present) => {
              if (present) return
              const action = store.action
              setStore("action", undefined)

              if (action === "manage") {
                props.onManage()

                return
              }

              if (action === "connect") {
                props.onConnect?.()

                return
              }

              if (action === "select") queueMicrotask(props.onClose)
            }}
          >
            <div
              ref={content}
              tabIndex={-1}
              data-slot="model-selector-drawer"
              class="flex min-h-0 flex-col gap-2 outline-none"
            >
              <div class="flex min-h-0 flex-col">
                <ModelList
                  mobile
                  open={store.open}
                  model={props.model}
                  provider={props.provider}
                  onSelect={() => setStore({ open: false, action: "select", restoreTrigger: false })}
                />
              </div>
              <div data-slot="model-selector-actions" class="flex flex-col gap-2">
                <Button
                  variant="ghost"
                  class="w-full !h-10 !justify-start"
                  icon="outline-sliders"
                  onClick={() => setStore({ open: false, action: "manage", restoreTrigger: false })}
                >
                  {language.t("dialog.model.manage")}
                </Button>
                <Show when={props.onConnect}>
                  <Button
                    variant="ghost"
                    class="w-full !h-10 !justify-start"
                    icon="plus"
                    onClick={() => setStore({ open: false, action: "connect", restoreTrigger: false })}
                  >
                    {language.t("command.provider.connect")}
                  </Button>
                </Show>
                <Show when={props.chatgptPlan}>
                  <div class="flex min-h-10 items-center gap-2 border-t border-v2-border-border-muted px-3 py-2 text-[13px] leading-5 text-v2-text-text-base">
                    <ProviderModelIcon provider={{ id: "openai", name: "OpenAI" }} class="shrink-0" />
                    <span class="min-w-0 flex-1 truncate">{language.t("dialog.model.chatgptPlan")}</span>
                    <ExternalLink
                      href="https://chatgpt.com/settings/usage"
                      class="flex shrink-0 items-center gap-1 rounded-sm text-v2-text-text-muted no-underline hover:text-v2-text-text-base focus-visible:outline focus-visible:outline-2"
                    >
                      {language.t("dialog.model.chatgptManageUsage")}
                      <Icon name="arrow-up-right" size="small" />
                    </ExternalLink>
                  </div>
                </Show>
              </div>
            </div>
          </MobilePanelDrawer>
        </Suspense>
      </Show>
    </>
  )
}

function createModelSelectorController(input: {
  provider: () => string | undefined
  model?: ModelState
  onSelect: () => void
}) {
  const model = input.model ?? useLocal().model

  const allModels = createMemo(() =>
    model
      .list()
      .filter((item) => model.visible({ modelID: item.id, providerID: item.provider.id }))
      .filter((item) => (input.provider() ? item.provider.id === input.provider() : true)),
  )

  return {
    all: () => model.list().filter((item) => (input.provider() ? item.provider.id === input.provider() : true)),
    models: (search: string) => {
      const query = search.trim()

      const filtered = query
        ? allModels().filter((item) => matchesModelSearch(query, [item.name, item.id, item.provider.name]))
        : allModels()

      return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
    },
    groups: (models: ModelItem[]) => {
      const byProvider = new Map<string, ModelItem[]>()

      for (const item of models) {
        byProvider.set(item.provider.id, [...(byProvider.get(item.provider.id) ?? []), item])
      }

      return Array.from(byProvider, ([category, items]) => ({ category, items })).sort(sortModelGroups)
    },
    current: () => {
      const value = model.current()

      return value ? modelKey(value) : undefined
    },
    select: (item: ModelItem, variant?: string | null) => {
      model.set({ modelID: item.id, providerID: item.provider.id }, { recent: true })

      if (variant !== undefined) model.variant.set(variant ?? undefined)
      input.onSelect()
    },
    variant: (item: ModelItem) => model.variant.current({ providerID: item.provider.id, modelID: item.id }),
    favorites: () => model.favorite.list().filter((item) => !input.provider() || item.provider.id === input.provider()),
    recent: () =>
      model
        .recent()
        .flatMap((item) => (item && (!input.provider() || item.provider.id === input.provider()) ? [item] : [])),
    favorite: (item: ModelItem) => model.favorite.list().some((entry) => modelKey(entry) === modelKey(item)),
    toggleFavorite: (item: ModelItem) => model.favorite.toggle({ providerID: item.provider.id, modelID: item.id }),
  }
}

function createProviderLabels(all: () => ModelItem[]) {
  const managed = createMemo(() => consoleModelGroup(all()))
  const managedIDs = createMemo(() => new Set(managed()?.providers.map((provider) => provider.id)))
  const canonical = (provider: ModelItem["provider"]) => provider.canonical ?? provider.id.replace(/^console-/, "")

  const direct = createMemo(
    () =>
      new Set(
        all()
          .filter((item) => !managedIDs().has(item.provider.id))
          .map((item) => canonical(item.provider)),
      ),
  )

  return {
    name: (provider: ModelItem["provider"]) => {
      const group = managed()

      return group && managedIDs().has(provider.id) ? consoleProviderName(group, provider.name) : provider.name
    },
    // The workspace badge only disambiguates a managed provider that is also connected directly.
    workspace: (provider: ModelItem["provider"]) => {
      const group = managed()

      if (!group || !managedIDs().has(provider.id) || !direct().has(canonical(provider))) return

      return group.workspace
    },
  }
}

type ModelGroup = { category: string; items: ModelItem[]; title?: string }

// Favorites and recent models lead the list until a search narrows it. They also stay in their provider group.
function withSections(input: {
  groups: ModelGroup[]
  favorites: ModelItem[]
  recent: ModelItem[]
  titles: { favorite: string; recent: string }
}): ModelGroup[] {
  const favorites = new Set(input.favorites.map(modelKey))

  const recent = input.recent.filter((item) => !favorites.has(modelKey(item)))

  return [
    ...(input.favorites.length > 0
      ? [{ category: "favorite", title: input.titles.favorite, items: input.favorites }]
      : []),
    ...(recent.length > 0 ? [{ category: "recent", title: input.titles.recent, items: recent }] : []),
    ...input.groups,
  ]
}

// A model can appear in a section and in its provider group, so section rows get their own key.
const rowKey = (group: ModelGroup, item: ModelItem) =>
  group.title ? `${group.category}:${modelKey(item)}` : modelKey(item)

// Steps to the next row for a different model, so a section copy never hands the arrow keys to its twin.
function nextRow(rows: { id: string; item: ModelItem }[], active: string, delta: number) {
  const start = Math.max(
    rows.findIndex((row) => row.id === active),
    0,
  )

  const model = rows[start] ? modelKey(rows[start].item) : undefined

  return (
    Array.from(
      { length: rows.length },
      (_, step) => rows[(start + (delta + rows.length) * (step + 1)) % rows.length],
    ).find((row) => modelKey(row.item) !== model)?.id ?? active
  )
}

function createChatgptPlan(current: () => string | undefined) {
  const data = useData()
  const location = useWorkspaceLocation()

  return () => {
    if (!current()?.startsWith("openai:")) return false

    const connection = data.location.integration
      .list(location().ref)
      ?.find((integration) => integration.id === "openai")?.connections[0]

    return connection?.type === "credential" && connection.method === "oauth"
  }
}

function ChatgptPlanFooter() {
  const language = useLanguage()

  return (
    <>
      <div class="h-px bg-v2-border-border-muted" />
      <div class="flex min-h-10 items-center gap-2 px-3 py-2 text-[13px] leading-5 text-v2-text-text-base">
        <ProviderModelIcon provider={{ id: "openai", name: "OpenAI" }} class="shrink-0" />
        <span class="min-w-0 flex-1 truncate">{language.t("dialog.model.chatgptPlan")}</span>
        <ExternalLink
          href="https://chatgpt.com/settings/usage"
          class="flex shrink-0 items-center gap-1 rounded-sm text-v2-text-text-muted no-underline hover:text-v2-text-text-base focus-visible:outline focus-visible:outline-2"
        >
          {language.t("dialog.model.chatgptManageUsage")}
          <Icon name="arrow-up-right" size="small" />
        </ExternalLink>
      </div>
    </>
  )
}

export function DialogSelectModel(props: { provider?: string; model?: ModelState }) {
  const dialog = useDialog()
  const language = useLanguage()

  const controller = createModelSelectorController({
    model: props.model,
    provider: () => props.provider,
    onSelect: () => dialog.close(),
  })

  const labels = createProviderLabels(controller.all)
  const chatgptPlan = createChatgptPlan(controller.current)

  const [store, setStore] = createStore({
    search: "",
    active: controller.current() ?? "",
    flyout: "",
    keyboard: true,
    navigated: false,
    warm: false,
    position: { left: 0, top: 0 },
  })

  const [staged, setStaged] = createStore<Record<string, string | null>>({})

  let container: HTMLElement | undefined
  let input: HTMLInputElement | undefined
  let flyoutRef: HTMLDivElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))

  const models = createMemo(() => controller.models(store.search))

  const groups = createMemo((): ModelGroup[] => {
    const providers = controller.groups(models())

    if (store.search.trim()) return providers

    return withSections({
      groups: providers,
      favorites: controller.favorites(),
      recent: controller.recent(),
      titles: { favorite: language.t("dialog.model.favorites"), recent: language.t("dialog.model.recent") },
    })
  })

  const rows = createMemo(() =>
    groups().flatMap((group) => group.items.map((item) => ({ id: rowKey(group, item), item }))),
  )

  const rowItem = (id: string) => rows().find((row) => row.id === id)?.item
  const activeItem = () => rowItem(store.active)
  const flyoutItem = () => (store.flyout ? rowItem(store.flyout) : undefined)
  const variantsOf = (item: ModelItem) => Object.keys(item.variants ?? {})

  setStore("active", rows().find((row) => modelKey(row.item) === controller.current())?.id ?? "")

  const variant = (item: ModelItem) =>
    modelKey(item) in staged ? (staged[modelKey(item)] ?? undefined) : controller.variant(item)

  const choose = (item: ModelItem, value?: string | null) =>
    controller.select(item, value === undefined ? staged[modelKey(item)] : value)

  const manage = async () => {
    const { DialogManageModels } = await import("./manage")
    void dialog.show(() => <DialogManageModels />)
  }

  const setSearch = (value: string) => {
    const first = controller.models(value)[0]
    setStore({ search: value, active: first ? modelKey(first) : "", flyout: "", keyboard: true, navigated: false })
  }

  const triangle = createSafeTriangle({
    flyout: () => (flyoutItem() && flyoutRef?.isConnected ? flyoutRef : undefined),
  })

  const openFlyout = (id: string, row: HTMLElement) => {
    const box = row.closest('[data-slot="dialog-container"]')?.getBoundingClientRect()

    if (!box) return
    const left = language.direction() === "rtl" ? box.left - 4 - 200 : box.right + 4
    setStore({ flyout: id, warm: true, position: { left, top: row.getBoundingClientRect().top - 2 } })
  }

  const hover = (id: string, row: HTMLElement) => {
    if (store.active === id && !store.keyboard) return
    setStore({ active: id, keyboard: false })
    clearTimeout(timer)

    if (store.warm) {
      openFlyout(id, row)

      return
    }

    setStore("flyout", "")
    timer = setTimeout(() => openFlyout(id, row), 100)
  }

  // Rows the pointer crosses on its way into the open flyout leave it alone.
  const move = (id: string, event: MouseEvent & { currentTarget: HTMLElement }) => {
    const row = event.currentTarget
    const point = { x: event.clientX, y: event.clientY }

    if (flyoutItem() && store.flyout !== id && triangle.hold(point, () => hover(id, row))) return
    triangle.anchor(point)
    hover(id, row)
  }

  const close = () => setStore("flyout", "")

  createEffect(() => {
    if (!flyoutItem()) {
      triangle.reset()

      return
    }
    // Outside the rows, such as the gap before the flyout, leaving the triangle closes it.

    createEventListener(document, "pointermove", (event: PointerEvent) => {
      const target = event.target

      if (target instanceof Element && target.closest('[data-slot="model-dialog-row"]')) return

      if (target instanceof Node && flyoutRef?.contains(target)) return

      if (!triangle.contains({ x: event.clientX, y: event.clientY })) close()
    })
  })

  // The flyout is placed once when it opens, so moving the rows under it closes it instead.
  createEventListener(window, "resize", close)

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.metaKey || event.altKey || event.ctrlKey) return

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()

      if (rows().length === 0) return
      setStore({
        active: nextRow(rows(), store.active, event.key === "ArrowDown" ? 1 : -1),
        keyboard: true,
        navigated: true,
        flyout: "",
      })
      queueMicrotask(() =>
        container
          ?.querySelector(`[data-option-key="${CSS.escape(store.active)}"]`)
          ?.scrollIntoView({ block: "nearest" }),
      )

      return
    }

    // While searching, left and right edit the query until the arrows have moved through the results.
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && (!store.search || store.navigated)) {
      const item = activeItem()

      if (!item || variantsOf(item).length === 0) return
      event.preventDefault()
      const options = [undefined, ...variantsOf(item)]
      const direction = (event.key === "ArrowRight") !== (language.direction() === "rtl") ? 1 : -1
      const index = options.indexOf(variant(item))
      setStaged(modelKey(item), options[(index + direction + options.length) % options.length] ?? null)
      setStore({ keyboard: true, flyout: "" })

      return
    }

    if (event.key !== "Enter") return
    const item = activeItem()

    if (!item) return
    event.preventDefault()
    choose(item)
  }

  const Row = (row: { id: string; item: ModelItem; section: boolean }) => {
    const selected = () => controller.current() === modelKey(row.item)
    const active = () => store.active === row.id

    return (
      <button
        type="button"
        data-slot="model-dialog-row"
        data-option-key={row.id}
        data-active={active() ? "" : undefined}
        aria-pressed={selected()}
        onMouseMove={(event) => move(row.id, event)}
        onMouseLeave={(event) => {
          clearTimeout(timer)
          const target = event.relatedTarget

          if (target instanceof Element && target.closest('[data-slot="model-dialog-row"]')) return

          if (target instanceof Node && flyoutRef?.contains(target)) return

          if (flyoutItem() && triangle.contains({ x: event.clientX, y: event.clientY })) return
          close()
        }}
        onClick={() => choose(row.item)}
      >
        <span class="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span class="min-w-0 truncate">{row.item.name}</span>
          <Show when={row.section}>
            <span class="min-w-0 shrink-[999] truncate text-v2-text-text-faint">{labels.name(row.item.provider)}</span>
          </Show>
        </span>
        <Show when={isFree(row.item.provider.id, row.item.cost)}>
          <Badge class="shrink-0">{language.t("model.tag.free")}</Badge>
        </Show>
        <Show when={row.item.latest}>
          <Badge class="shrink-0">{language.t("model.tag.latest")}</Badge>
        </Show>
        <Show when={variantsOf(row.item).length > 0}>
          <span
            data-slot="model-dialog-variant"
            class="w-[72px] shrink-0 truncate text-end capitalize"
            classList={{ invisible: !selected() && !active() }}
          >
            {variant(row.item) ?? language.t("common.default")}
          </span>
        </Show>
        <span class="flex size-4 shrink-0 items-center justify-center">
          <Show when={selected()}>
            <Icon name="check" size="small" />
          </Show>
        </span>
      </button>
    )
  }

  return (
    <Dialog class="command-palette model-dialog" size="large">
      <div class="sr-only">
        <DialogTitle>{language.t("dialog.model.select.title")}</DialogTitle>
      </div>
      <DialogBody class="command-palette-body">
        <div data-slot="model-dialog-search">
          <div data-slot="model-dialog-search-box" onClick={() => input?.focus()}>
            <Icon name="magnifying-glass" size="small" class="shrink-0" />
            <input
              ref={(element) => (input = element)}
              type="search"
              value={store.search}
              autofocus
              placeholder={language.t("dialog.model.search.placeholder")}
              aria-label={language.t("dialog.model.search.placeholder")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              onInput={(event) => setSearch(event.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
            <Show when={store.search.trim()}>
              <button
                type="button"
                class="-me-1 flex size-5 shrink-0 items-center justify-center rounded-sm bg-transparent text-v2-icon-icon-faint transition-colors hover:text-v2-icon-icon-base [&>*]:block"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => setSearch("")}
                aria-label={language.t("common.clear")}
              >
                <Icon name="circle-xmark" />
              </button>
            </Show>
            <Tooltip placement="top" gutter={4} value={language.t("dialog.model.manage")} ignoreSafeArea={false}>
              <button
                type="button"
                class="flex size-7 shrink-0 items-center justify-center rounded-sm bg-transparent text-v2-icon-icon-muted transition-colors hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-icon-icon-base focus-visible:outline-none"
                aria-label={language.t("dialog.model.manage")}
                onPointerDown={(event) => event.preventDefault()}
                onClick={manage}
              >
                <Icon name="outline-sliders" size="small" />
              </button>
            </Tooltip>
          </div>
        </div>
        <ScrollView
          class="command-palette-scroll"
          viewportRef={(element) => {
            container = element
            // Scrolling moves the flyout's row away without a pointer event, which would leave it detached.
            createEventListener(element, "scroll", close)
          }}
        >
          <div data-slot="model-dialog-results">
            <Show
              when={models().length > 0}
              fallback={<div class="command-palette-state">{language.t("dialog.model.empty")}</div>}
            >
              <For each={groups()}>
                {(group) => (
                  <div data-slot="model-dialog-group">
                    <div data-slot="model-dialog-group-title">
                      <Show
                        when={group.title}
                        fallback={
                          <>
                            <ProviderModelIcon provider={group.items[0].provider} class="!size-3.5 shrink-0" />
                            <span class="min-w-0 truncate">{labels.name(group.items[0].provider)}</span>
                            <Show when={labels.workspace(group.items[0].provider)}>
                              {(workspace) => <Badge class="shrink-0">{workspace()}</Badge>}
                            </Show>
                          </>
                        }
                      >
                        {(title) => <span class="min-w-0 truncate">{title()}</span>}
                      </Show>
                    </div>
                    <For each={group.items}>
                      {(item) => <Row id={rowKey(group, item)} item={item} section={!!group.title} />}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </ScrollView>
        <Show when={chatgptPlan()}>
          <ChatgptPlanFooter />
        </Show>
        <div data-slot="model-dialog-hints">
          <span>
            <Keybind keys={["↑", "↓"]} variant="neutral" />
            {language.t("dialog.model.hint.navigate")}
          </span>
          <span>
            <Keybind keys={["←", "→"]} variant="neutral" />
            {language.t("dialog.model.hint.variant")}
          </span>
          <span>
            <Keybind keys={["↵"]} variant="neutral" />
            {language.t("dialog.model.hint.select")}
          </span>
        </div>
      </DialogBody>
      <Show when={flyoutItem()}>
        {(item) => (
          // Inside the dialog content, so clicks here are not outside clicks that dismiss the dialog.
          <div
            ref={(element) => (flyoutRef = element)}
            data-component="menu-v2-content"
            data-slot="model-dialog-flyout"
            class="!fixed max-h-[400px] w-[200px] overflow-y-auto !p-0 !animate-none"
            style={{ left: `${store.position.left}px`, top: `${store.position.top}px` }}
            onMouseEnter={() => triangle.cancel()}
          >
            <div class="flex flex-col p-0.5">
              <For each={variantsOf(item()).length > 0 ? [undefined, ...variantsOf(item())] : []}>
                {(value) => (
                  <div
                    data-component="menu-v2-item"
                    role="menuitemradio"
                    aria-checked={variant(item()) === value}
                    data-checked={variant(item()) === value ? "" : undefined}
                    onMouseEnter={(event) => event.currentTarget.setAttribute("data-highlighted", "")}
                    onMouseLeave={(event) => event.currentTarget.removeAttribute("data-highlighted")}
                    onClick={() => choose(item(), value ?? null)}
                  >
                    <span data-slot="menu-v2-item-content" class="capitalize">
                      {value ?? language.t("common.default")}
                    </span>
                    <span data-slot="menu-v2-item-indicator" data-checked={variant(item()) === value ? "" : undefined}>
                      <Icon name="check" size="small" />
                    </span>
                  </div>
                )}
              </For>
              <Show when={variantsOf(item()).length > 0}>
                <div data-slot="menu-v2-separator" />
              </Show>
              <div
                data-component="menu-v2-item"
                role="menuitem"
                onMouseEnter={(event) => event.currentTarget.setAttribute("data-highlighted", "")}
                onMouseLeave={(event) => event.currentTarget.removeAttribute("data-highlighted")}
                onClick={() => {
                  controller.toggleFavorite(item())
                  // Favoriting adds or removes a section above, which moves the row under the flyout.
                  requestAnimationFrame(() => {
                    const row = container?.querySelector<HTMLElement>(`[data-option-key="${CSS.escape(store.flyout)}"]`)

                    if (!row) return close()
                    openFlyout(store.flyout, row)
                  })
                }}
              >
                <span data-slot="menu-v2-item-content">
                  {controller.favorite(item())
                    ? language.t("dialog.model.unfavorite")
                    : language.t("dialog.model.favorite")}
                </span>
              </div>
            </div>
            <ModelDetails model={item()} provider={labels.name(item().provider)} compact />
          </div>
        )}
      </Show>
    </Dialog>
  )
}
