import { Popover } from "@kobalte/core/popover"
import {
  Component,
  ComponentProps,
  createEffect,
  createMemo,
  createSignal,
  For,
  JSX,
  Show,
  Suspense,
  lazy,
  on,
  onCleanup,
  untrack,
} from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal, type ModelSelection } from "@/providers/models/selection"
import { isFreeModel } from "@/providers/models/models"
import { useDialog } from "@opencode/ui/context/dialog"
import { popularProviders } from "@/providers/catalog/providers"
import { Button } from "@opencode/ui/button"
import { Badge } from "@opencode/ui/badge"
import { Dialog, DialogBody, DialogTitle } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { MenuScroll } from "@opencode/ui/menu-scroll"
import { SearchHighlight, SearchList, type SearchListHandle, type SearchListRow } from "@opencode/ui/search-list"
import { Tooltip } from "@opencode/ui/tooltip"
import { TextInput } from "@opencode/ui/text-input"
import { ModelTooltip } from "./tooltip"
import { ModelDetails } from "./details"
import { useLanguage } from "@/runtime/i18n/language"
import { ExternalLink } from "@/runtime/platform/external-link"
import { useData } from "@/runtime/server/current"
import { useWorkspaceLocation } from "@/workspaces/location"
import { createModelUsage, ModelUsageTag } from "@/usage/model"
import {
  correctFlyoutPosition,
  createDialogFlyoutState,
  createModelDrawerState,
  placeFlyout,
  selectDrawerLoaded,
  selectDrawerOpen,
  selectDrawerRestoreTrigger,
  selectFlyoutFollowsPointer,
  selectFlyoutOpenId,
  selectFlyoutPosition,
  transitionDialogFlyout,
  transitionModelDrawer,
  type DialogFlyoutEffect,
  type DialogFlyoutEvent,
  type ModelDrawerEvent,
} from "./select-dialog-machine"
import { formatKeybindParts, matchKeybind, parseKeybind } from "@/shell/commands/command"
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

type ModelState = ModelSelection

type ModelItem = ReturnType<ModelState["list"]>[number]

const favoriteKeybind = parseKeybind("mod+f")

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
  const usage = createModelUsage({ refresh: true })

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
    active: "",
    collapsed: {},
  })

  const models = createMemo(() => controller.models(store.search))
  const modelGroups = createMemo(() => controller.groups(models()))
  const managed = createMemo(() => consoleModelGroup(controller.all()))
  const expanded = (provider: string) => store.search.length > 0 || !store.collapsed[provider]
  const managedIDs = createMemo(() => new Set(managed()?.providers.map((provider) => provider.id) ?? []))

  // Rows in display order: ProviderModelSections nests every managed provider at the first one's position.
  const visibleModels = () => {
    const groups = modelGroups()
    const first = groups.findIndex((group) => managedIDs().has(group.category))

    return groups.flatMap((group, index) => {
      if (!managedIDs().has(group.category)) return expanded(group.category) ? group.items : []

      if (index !== first || !expanded(CONSOLE_GROUP_KEY)) return []

      return groups
        .filter((item) => managedIDs().has(item.category) && expanded(item.category))
        .flatMap((item) => item.items)
    })
  }

  let scrollRef: HTMLDivElement | undefined

  const setSearch = (value: string) => {
    setStore("search", value)
    const first = visibleModels()[0]
    setStore("active", first ? modelKey(first) : "")
  }

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return
        setSearch("")
        scrollRef?.scrollTo(0, 0)
      },
    ),
  )

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
                    value={<ModelTooltip model={item} latest={item.latest} free={isFreeModel(item)} v2 />}
                  >
                    <span class="min-w-0 truncate">{item.name}</span>
                  </Tooltip>
                  <Show when={isFreeModel(item)}>
                    <Badge class="shrink-0">{language.t("model.tag.free")}</Badge>
                  </Show>
                  <Show when={item.latest}>
                    <Badge class="shrink-0">{language.t("model.tag.latest")}</Badge>
                  </Show>
                  <Show when={usage(item)}>{(value) => <ModelUsageTag usage={value()} />}</Show>
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
    void dialog.show(() => <DialogConnectProvider directory={location().directory} selection={props.model} />)
  }

  return (
    <ModelDrawer
      trigger={props.trigger}
      onManage={manage}
      model={props.model}
      provider={props.provider}
      onConnect={connect}
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
  const [drawer, setDrawer] = createSignal(createModelDrawerState())
  let closeTimer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: ModelDrawerEvent) => {
    const next = transitionModelDrawer(untrack(drawer), event)
    setDrawer(next.state)
    next.effects.forEach((effect) => {
      if (effect.type === "schedule-close-timeout") {
        clearTimeout(closeTimer)
        closeTimer = setTimeout(() => dispatch({ type: "close.timed-out", attempt: effect.attempt }), effect.delayMs)

        return
      }

      if (effect.type === "cancel-close-timeout") return clearTimeout(closeTimer)

      if (effect.action === "manage") return props.onManage()

      if (effect.action === "connect") return props.onConnect?.()
      queueMicrotask(props.onClose)
    })
  }

  onCleanup(() => {
    clearTimeout(closeTimer)
    dispatch({ type: "disposed" })
  })

  let trigger: HTMLDivElement | undefined
  let content: HTMLDivElement | undefined

  return (
    <>
      <div ref={trigger} class="min-w-0">
        {props.trigger({
          "aria-haspopup": "dialog",
          get "aria-expanded"() {
            return selectDrawerOpen(drawer())
          },
          onClick: () => dispatch({ type: "opened" }),
        })}
      </div>
      <Show when={selectDrawerLoaded(drawer())}>
        <Suspense>
          <MobilePanelDrawer
            hideHeader
            title={language.t("dialog.model.select.title")}
            open={selectDrawerOpen(drawer())}
            onOpenChange={(open) => dispatch({ type: open ? "opened" : "dismissed" })}
            initialFocus={() => content}
            returnFocus={() => trigger?.querySelector("button") ?? undefined}
            onFinalFocus={(event) => {
              if (!selectDrawerRestoreTrigger(drawer())) event.preventDefault()
            }}
            onContentPresentChange={(present) => {
              if (!present) dispatch({ type: "hidden" })
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
                  open={selectDrawerOpen(drawer())}
                  model={props.model}
                  provider={props.provider}
                  onSelect={() => dispatch({ type: "action.selected", action: "select" })}
                />
              </div>
              <div data-slot="model-selector-actions" class="flex flex-col gap-2">
                <Button
                  variant="ghost"
                  class="w-full !h-10 !justify-start"
                  icon="outline-sliders"
                  onClick={() => dispatch({ type: "action.selected", action: "manage" })}
                >
                  {language.t("dialog.model.manage")}
                </Button>
                <Show when={props.onConnect}>
                  <Button
                    variant="ghost"
                    class="w-full !h-10 !justify-start"
                    icon="plus"
                    onClick={() => dispatch({ type: "action.selected", action: "connect" })}
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

// Favorites and recent models lead the list until a search narrows it. As in the TUI, they then leave their provider
// group, so no model is listed twice.
function withSections(input: {
  groups: ModelGroup[]
  favorites: ModelItem[]
  recent: ModelItem[]
  titles: { favorite: string; recent: string }
}): ModelGroup[] {
  const favorites = new Set(input.favorites.map(modelKey))

  const recent = input.recent.filter((item) => !favorites.has(modelKey(item)))
  const listed = new Set([...favorites, ...recent.map(modelKey)])

  return [
    ...(input.favorites.length > 0
      ? [{ category: "favorite", title: input.titles.favorite, items: input.favorites }]
      : []),
    ...(recent.length > 0 ? [{ category: "recent", title: input.titles.recent, items: recent }] : []),
    ...input.groups.flatMap((group) => {
      const items = group.items.filter((item) => !listed.has(modelKey(item)))

      return items.length > 0 ? [{ ...group, items }] : []
    }),
  ]
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))

const round = (value: number) => Math.round(value * 1000) / 1000

type ModelRow = { id: string; item: ModelItem; group: ModelGroup }

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
  const usage = createModelUsage({ refresh: true })

  // `navigated`: the arrows have moved through the results since the query last changed.
  const [query, setQuery] = createStore({ search: "", navigated: false })
  const [flyout, setFlyout] = createSignal(createDialogFlyoutState())
  const [staged, setStaged] = createStore<Record<string, string | null>>({})

  let list: SearchListHandle<ModelRow> | undefined
  let flyoutRef: HTMLDivElement | undefined
  let scroller: HTMLDivElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let pointer: { x: number; y: number } | undefined

  const groups = createMemo((): ModelGroup[] => {
    const providers = controller.groups(controller.models(query.search))

    if (query.search.trim()) {
      const visible = new Set(providers.flatMap((group) => group.items.map(modelKey)))

      return withSections({
        groups: providers,
        favorites: [],
        recent: controller.recent().filter((item) => visible.has(modelKey(item))),
        titles: { favorite: language.t("dialog.model.favorites"), recent: language.t("dialog.model.recent") },
      })
    }

    return withSections({
      groups: providers,
      favorites: controller.favorites(),
      recent: controller.recent(),
      titles: { favorite: language.t("dialog.model.favorites"), recent: language.t("dialog.model.recent") },
    })
  })

  const rows = createMemo(() =>
    groups().flatMap((group) => group.items.map((item): ModelRow => ({ id: modelKey(item), item, group }))),
  )

  const rowItem = (id: string) => rows().find((row) => row.id === id)?.item
  const flyoutId = createMemo(() => selectFlyoutOpenId(flyout()))

  const flyoutItem = () => {
    const id = flyoutId()

    return id ? rowItem(id) : undefined
  }

  const variantsOf = (item: ModelItem) => Object.keys(item.variants ?? {})
  const favorite = (item: ModelItem) => controller.favorites().some((entry) => modelKey(entry) === modelKey(item))

  const variant = (item: ModelItem) =>
    modelKey(item) in staged ? (staged[modelKey(item)] ?? undefined) : controller.variant(item)

  const choose = (item: ModelItem, value?: string | null) =>
    controller.select(item, value === undefined ? staged[modelKey(item)] : value)

  const setSearch = (value: string) => {
    setQuery({ search: value, navigated: false })
    dispatch({ type: "keyboard" })
  }

  const manage = async () => {
    const { DialogManageModels } = await import("./manage")
    void dialog.show(() => <DialogManageModels />)
  }

  const location = useWorkspaceLocation()

  const connect = async () => {
    const { DialogConnectProvider } = await import("@/providers/connect/dialog")
    // The model chosen after connecting applies to this composer.
    void dialog.show(() => <DialogConnectProvider directory={location().directory} selection={props.model} />)
  }

  const flyoutRect = () => (flyoutRef?.isConnected ? flyoutRef.getBoundingClientRect() : undefined)

  const measure = (id: string) => {
    const row = scroller?.querySelector<HTMLElement>(
      `[data-slot="search-list-row"][data-option-key="${CSS.escape(id)}"]`,
    )

    if (!row?.closest('[data-slot="dialog-container"]')) return undefined

    return placeFlyout(
      row.getBoundingClientRect(),
      row.closest("[data-dialog-layer]")?.getBoundingClientRect(),
      language.direction() === "rtl",
    )
  }

  const dispatch = (event: DialogFlyoutEvent) => {
    const next = transitionDialogFlyout(untrack(flyout), event)
    // Written before the effects run, so a `place` measures the flyout this state renders.
    setFlyout(next.state)
    next.effects.forEach(runFlyoutEffect)
  }

  const runFlyoutEffect = (effect: DialogFlyoutEffect) => {
    if (effect.type === "activate") return list?.setActive(effect.id)

    if (effect.type === "cancel") return clearTimeout(timer)

    if (effect.type === "schedule") {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (effect.kind === "open") return dispatch({ type: "open.due", attempt: effect.attempt })

        if (effect.kind === "aim") return dispatch({ type: "aim.due", attempt: effect.attempt, point: pointer })
        dispatch({ type: "warm.expired", attempt: effect.attempt })
      }, effect.delayMs)

      return
    }

    const position = measure(effect.id)
    dispatch({ type: "placed", attempt: effect.attempt, position })
    // A fixed element is placed against the viewport unless an ancestor contains it, as a component preview that holds
    // its dialogs does. Correct by where it landed, before it paints.
    const placed = position ? flyoutRect() : undefined

    if (!position || !placed) return
    const corrected = correctFlyoutPosition(position, { x: placed.left, y: placed.top })

    if (corrected !== position) dispatch({ type: "placed", attempt: effect.attempt, position: corrected })
  }

  onCleanup(() => {
    clearTimeout(timer)
    dispatch({ type: "disposed" })
  })

  createEventListener(document, "pointermove", (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY }
  })

  // Scrolling moves rows under a still cursor without a pointer event. A wheel scroll highlights the row that lands
  // under the cursor and moves the flyout beside it; a keyboard scroll keeps its highlight and closes the flyout,
  // which would otherwise be left beside a row that moved away.
  const follow = () => {
    if (!selectFlyoutFollowsPointer(untrack(flyout))) return
    const point = pointer

    const row = point
      ? document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-slot="search-list-row"]')
      : undefined

    const id = row?.dataset.optionKey
    dispatch({ type: "scrolled", target: point && row && id && scroller?.contains(row) ? { id, point } : undefined })
  }

  // As on the home page, every header sticks for the whole list, so the next one slides over the stuck one while the
  // stuck label fades out over 16px. The topmost stuck header also fades a gradient in as rows scroll beneath it.
  const fadeHeaders = () => {
    const viewport = scroller?.querySelector<HTMLElement>('[data-slot="search-list-scroll"]')

    if (!viewport) return
    const origin = viewport.getBoundingClientRect().top
    const headers = [...viewport.querySelectorAll<HTMLElement>('[data-slot="search-list-header"]')]

    // Every read before any write, so the scroll lays out once.
    const tops = headers.map((header) => header.getBoundingClientRect().top - origin)
    const stuck = tops.findLastIndex((top) => top < 0.5)

    const labelOf = (header: HTMLElement | undefined) =>
      header?.querySelector<HTMLElement>('[data-slot="model-dialog-header-label"]') ?? undefined

    const labels = headers.map((header, index) => {
      const label = labelOf(header)
      const next = tops[index + 1]
      const nextLabel = labelOf(headers[index + 1])

      if (!label || next === undefined || !nextLabel) return { label, opacity: 1 }

      // Fades out as the next label comes up, gone just as it would touch this one.
      return { label, opacity: clamp((next + nextLabel.offsetTop - label.offsetTop - label.offsetHeight) / 16) }
    })

    const header = headers[stuck]
    const row = header?.nextElementSibling
    // How far the rows under the stuck header have scrolled beneath it, from where its first row rests.
    const hidden = header && row ? header.offsetHeight + 4 - (row.getBoundingClientRect().top - origin) : 0

    labels.forEach((item) => item.label?.style.setProperty("opacity", String(round(item.opacity))))
    headers.forEach((item, index) => item.toggleAttribute("data-stuck", index === stuck))
    header?.style.setProperty("--model-dialog-header-fade", String(round(clamp(hidden / 16))))
  }

  // Results that change without a scroll, such as a narrower search, move the headers too.
  createEffect(
    on(rows, () => {
      const frame = requestAnimationFrame(fadeHeaders)
      onCleanup(() => cancelAnimationFrame(frame))
    }),
  )

  // The flyout's row left the results, such as when the models change, so it would be left beside nothing.
  createEffect(() => {
    if (flyoutId() && !flyoutItem()) dispatch({ type: "dismissed" })
  })

  createEffect(() => {
    if (!flyoutId()) return

    // Outside the rows, such as the gap before the flyout, leaving the triangle closes it.
    createEventListener(document, "pointermove", (event: PointerEvent) => {
      const target = event.target

      if (target instanceof Element && target.closest('[data-slot="search-list-row"]')) return

      if (target instanceof Node && flyoutRef?.contains(target)) return
      dispatch({ type: "pointer.outside", point: { x: event.clientX, y: event.clientY }, flyout: flyoutRect() })
    })
  })

  // The search field keeps focus for the dialog's life: a click anywhere else in the dialog, the rows, the scroll area
  // or the flyout, leaves it there, so the arrow keys always move the highlight instead of scrolling a container.
  // Tab still reaches the search row's buttons, so Add provider and Manage models stay keyboard accessible.
  const field = () => scroller?.querySelector<HTMLInputElement>('[data-slot="text-input-v2-input"]') ?? undefined

  const searchButton = (target: EventTarget | null) =>
    target instanceof Element && !!scroller?.contains(target.closest('[data-slot="text-input-v2-trailing"]'))

  const inDialog = (target: EventTarget | null) =>
    target instanceof Node &&
    (!!scroller?.closest('[data-slot="dialog-container"]')?.contains(target) || !!flyoutRef?.contains(target))

  createEventListener(
    document,
    "mousedown",
    (event: MouseEvent) => {
      if (inDialog(event.target) && event.target !== field()) event.preventDefault()
    },
    { capture: true },
  )

  createEventListener(document, "focusin", (event: FocusEvent) => {
    if (inDialog(event.target) && event.target !== field() && !searchButton(event.target))
      field()?.focus({ preventScroll: true })
  })

  // The flyout is placed once when it opens, so moving the rows under it closes it instead.
  createEventListener(window, "resize", () => dispatch({ type: "dismissed" }))

  const onKeyDown = (event: KeyboardEvent, active: ModelRow | undefined) => {
    if (matchKeybind(favoriteKeybind, event)) {
      if (!active) return
      event.preventDefault()
      controller.toggleFavorite(active.item)
      // The model moves between Favorites and its group under the same key, so the highlight follows it.
      list?.setActive(active.id)
      dispatch({ type: "keyboard" })

      return
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      setQuery("navigated", true)
      dispatch({ type: "keyboard" })

      return
    }

    if (event.metaKey || event.altKey || event.ctrlKey) return

    // While searching, left and right edit the query until the arrows have moved through the results.
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && (!query.search || query.navigated)) {
      const item = active?.item

      if (!item || variantsOf(item).length === 0) return
      event.preventDefault()
      const options = [undefined, ...variantsOf(item)]
      const direction = (event.key === "ArrowRight") !== (language.direction() === "rtl") ? 1 : -1
      const index = options.indexOf(variant(item))
      setStaged(modelKey(item), options[(index + direction + options.length) % options.length] ?? null)
      dispatch({ type: "keyboard" })
    }
  }

  const Row = (row: { model: ModelRow; attrs: SearchListRow }) => {
    const item = () => row.model.item
    const selected = () => controller.current() === modelKey(item())
    const active = () => row.attrs["data-active"] !== undefined

    return (
      <button
        type="button"
        {...row.attrs}
        data-option-key={row.model.id}
        aria-current={selected() ? "true" : undefined}
        onMouseMove={(event) => {
          // A still cursor must not take the highlight while the arrow keys scroll rows beneath it.
          if (event.movementX === 0 && event.movementY === 0) return

          dispatch({
            type: "row.moved",
            id: row.model.id,
            activeId: list?.active()?.id,
            point: { x: event.clientX, y: event.clientY },
            flyout: flyoutRect(),
          })
        }}
        onMouseLeave={(event) => {
          const target = event.relatedTarget

          const into =
            target instanceof Element && target.closest('[data-slot="search-list-row"]')
              ? "row"
              : target instanceof Node && flyoutRef?.contains(target)
                ? "flyout"
                : "outside"

          dispatch({ type: "row.left", into, point: { x: event.clientX, y: event.clientY }, flyout: flyoutRect() })
        }}
      >
        <span data-slot="model-dialog-check">
          <Show when={selected()}>
            <Icon name="check" size="small" />
          </Show>
        </span>
        <span data-slot="model-dialog-name">
          <span class="min-w-0 truncate">
            <SearchHighlight text={item().name} />
          </span>
          {/* Favorites and Recent mix providers, so their rows name one, with its workspace when its header has one. */}
          <Show when={row.model.group.title}>
            <span class="min-w-0 shrink-[999] truncate text-v2-text-text-faint">{labels.name(item().provider)}</span>
            <Show when={labels.workspace(item().provider)}>
              {(workspace) => <Badge class="shrink-0">{workspace()}</Badge>}
            </Show>
          </Show>
          <Show when={isFreeModel(item())}>
            <Badge class="shrink-0">{language.t("model.tag.free")}</Badge>
          </Show>
          <Show when={item().latest}>
            <Badge class="shrink-0">{language.t("model.tag.latest")}</Badge>
          </Show>
        </span>
        <Show when={usage(item())}>{(value) => <ModelUsageTag usage={value()} />}</Show>
        <Show when={active()}>
          <span data-slot="model-dialog-variant">
            <span class="truncate capitalize">{variant(item()) ?? language.t("common.default")}</span>
            <Icon name="chevron-right" size="small" />
          </span>
        </Show>
      </button>
    )
  }

  return (
    <Dialog class="command-palette model-dialog" size="large">
      <div class="sr-only">
        <DialogTitle>{language.t("dialog.model.select.title")}</DialogTitle>
      </div>
      <DialogBody class="command-palette-body">
        {/* Scrolling moves the flyout's row away without a pointer event, which would leave it detached. */}
        <div
          class="contents"
          ref={(element) => {
            scroller = element
            createEventListener(
              element,
              "scroll",
              () => {
                follow()
                fadeHeaders()
              },
              { capture: true },
            )
            // A wheel scroll is the pointer's, so the highlight and flyout follow the row under it.
            createEventListener(element, "wheel", () => dispatch({ type: "wheel" }), { passive: true })
          }}
        >
          <SearchList
            ref={(handle) => (list = handle)}
            query={query.search}
            onQuery={setSearch}
            placeholder={language.t("dialog.model.search.placeholder")}
            trailing={
              <>
                <Tooltip
                  placement="top"
                  gutter={4}
                  value={language.t("command.provider.connect")}
                  ignoreSafeArea={false}
                >
                  <IconButton
                    variant="ghost-muted"
                    icon={<Icon name="plus" size="small" />}
                    aria-label={language.t("command.provider.connect")}
                    onClick={connect}
                  />
                </Tooltip>
                <Tooltip placement="top" gutter={4} value={language.t("dialog.model.manage")} ignoreSafeArea={false}>
                  <IconButton
                    variant="ghost-muted"
                    icon={<Icon name="outline-sliders" size="small" />}
                    aria-label={language.t("dialog.model.manage")}
                    onClick={manage}
                  />
                </Tooltip>
              </>
            }
            items={rows()}
            key={(row) => row.id}
            section={(row) => row.group.category}
            header={(row) => (
              <span data-slot="model-dialog-header-label" class="flex min-w-0 items-center gap-1.5">
                <span class="min-w-0 truncate">{row.group.title ?? labels.name(row.item.provider)}</span>
                <Show when={!row.group.title && labels.workspace(row.item.provider)}>
                  {(workspace) => <Badge class="shrink-0">{workspace()}</Badge>}
                </Show>
              </span>
            )}
            empty={language.t("dialog.model.empty")}
            onSelect={(row) => choose(row.item)}
            onKeyDown={onKeyDown}
          >
            {(row, attrs) => <Row model={row()} attrs={attrs} />}
          </SearchList>
        </div>
        <Show when={chatgptPlan()}>
          <ChatgptPlanFooter />
        </Show>
      </DialogBody>
      <Show when={flyoutItem()}>
        {(item) => (
          // Inside the dialog content, so clicks here are not outside clicks that dismiss the dialog.
          <div
            ref={(element) => (flyoutRef = element)}
            data-component="menu-v2-content"
            data-slot="model-dialog-flyout"
            style={{
              left: `${selectFlyoutPosition(flyout())?.left ?? 0}px`,
              top: `${selectFlyoutPosition(flyout())?.top ?? 0}px`,
            }}
            onMouseEnter={() => dispatch({ type: "flyout.entered" })}
          >
            <MenuScroll>
              {/* A model without variants still lists Default, its only option. */}
              <For each={[undefined, ...variantsOf(item())]}>
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
              <div data-slot="menu-v2-separator" role="separator" />
              <div
                data-component="menu-v2-item"
                role="menuitem"
                onMouseEnter={(event) => event.currentTarget.setAttribute("data-highlighted", "")}
                onMouseLeave={(event) => event.currentTarget.removeAttribute("data-highlighted")}
                onClick={() => {
                  // The row moves between Favorites and its group, so the flyout would be left beside nothing.
                  controller.toggleFavorite(item())
                  dispatch({ type: "dismissed" })
                }}
              >
                <span data-slot="menu-v2-item-content">
                  {favorite(item()) ? language.t("dialog.model.unfavorite") : language.t("dialog.model.favorite")}
                </span>
                <Keybind keys={formatKeybindParts("mod+f", language.t)} variant="neutral" class="shrink-0" />
              </div>
              <div data-slot="menu-v2-separator" role="separator" />
              {/* The full name, "Workspace / Provider", where a workspace badge tells the connections apart. */}
              <ModelDetails
                model={item()}
                provider={labels.workspace(item().provider) ? item().provider.name : labels.name(item().provider)}
                compact
                standalone
                usage={usage(item())}
              />
            </MenuScroll>
          </div>
        )}
      </Show>
    </Dialog>
  )
}
