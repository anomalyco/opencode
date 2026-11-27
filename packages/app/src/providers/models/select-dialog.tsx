import { Popover } from "@kobalte/core/popover"
import {
  batch,
  Component,
  ComponentProps,
  createEffect,
  createMemo,
  createSelector,
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
import { DialogUsage } from "@/usage/dialog"
import {
  createDialogFlyoutState,
  createModelDrawerState,
  placeFlyout,
  selectDrawerLoaded,
  selectDrawerOpen,
  selectDrawerRestoreTrigger,
  selectFlyoutFollowsPointer,
  selectFlyoutMenu,
  selectFlyoutMenuKeys,
  selectFlyoutOpenId,
  selectFlyoutPosition,
  transitionDialogFlyout,
  transitionModelDrawer,
  type DialogFlyoutEffect,
  type DialogFlyoutEvent,
  type FlyoutRect,
  type ModelDrawerEvent,
} from "./select-dialog-machine"
import { formatKeybindParts, matchKeybind, parseKeybind } from "@/shell/commands/command"
import { createEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { matchesModelSearch } from "./search"
import { SettingsList } from "@/settings/list"
import {
  CONSOLE_GROUP_KEY,
  consoleModelGroup,
  ProviderModelIcon,
  ProviderModelSections,
} from "@/providers/models/provider-group"
import { consoleProviderName } from "@/providers/catalog/console"
import { useIntegrations } from "@/providers/catalog/integrations"
import { CONSOLE_INTEGRATION } from "@/providers/connect/dialog-machine"
import { providerAccounts } from "@/settings/providers/accounts"
import { useProviderAccountActions } from "@/settings/providers/account-actions"
import { pickerSections, signInAccounts, splitFreeModels, type PickerSection } from "./picker-sections"
import { WorkspaceHeader } from "./picker-header"
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

  // Rows in display order: ProviderModelSections nests every managed provider at the first one's position and lists
  // the free models last.
  const visibleModels = () => {
    const split = splitFreeModels(modelGroups())
    const first = split.groups.findIndex((group) => managedIDs().has(group.category))

    return [
      ...split.groups.flatMap((group, index) => {
        if (!managedIDs().has(group.category)) return expanded(group.category) ? group.items : []

        if (index !== first || !expanded(CONSOLE_GROUP_KEY)) return []

        return split.groups
          .filter((item) => managedIDs().has(item.category) && expanded(item.category))
          .flatMap((item) => item.items)
      }),
      ...(split.free && expanded(split.free.category) ? split.free.items : []),
    ]
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
              class="-mx-4 w-[calc(100%+32px)] px-4 text-start first:rounded-t-lg last:rounded-b-lg hover:bg-v2-overlay-simple-overlay-hover focus-visible:-outline-offset-2"
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
                  <Icon name="check" class="shrink-0 text-v2-icon-icon-base" />
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
          clearIcon="close"
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
                  icon="sliders"
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
      .filter((item) => (input.provider() ? item.provider.id === input.provider() : true))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
  )

  return {
    all: () => model.list().filter((item) => (input.provider() ? item.provider.id === input.provider() : true)),
    models: (search: string) => {
      const query = search.trim()

      if (!query) return allModels()

      return allModels().filter((item) => matchesModelSearch(query, [item.name, item.id, item.provider.name]))
    },
    groups: (models: ModelItem[]) =>
      [...Map.groupBy(models, (item) => item.provider.id)]
        .map(([category, items]) => ({ category, items }))
        .sort(sortModelGroups),
    current: () => {
      const value = model.standard?.() ?? model.current()

      return value ? modelKey(value) : undefined
    },
    select: (item: ModelItem, variant?: string | null) => {
      // Close the picker before updating recent/visibility so the closing list does not reconcile and re-measure.
      input.onSelect()
      batch(() => {
        model.set({ modelID: item.id, providerID: item.provider.id }, { recent: true })

        if (variant !== undefined) model.variant.set(variant ?? undefined)
      })
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
    group: managed,
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

const listTitles = {
  favorite: "dialog.model.favorites",
  recent: "dialog.model.recent",
  free: "dialog.model.group.free",
} as const

const clamp = (value: number) => Math.max(0, Math.min(1, value))

const round = (value: number) => Math.round(value * 1000) / 1000

type ModelRow = {
  id: string
  item: ModelItem
  section: string
  list: PickerSection<ModelItem>["list"]
  workspace: PickerSection<ModelItem>["workspace"]
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
  const data = useData()
  const location = useWorkspaceLocation()
  const integrations = useIntegrations(() => location().directory)
  const accountActions = useProviderAccountActions(() => location().directory)

  const controller = createModelSelectorController({
    model: props.model,
    provider: () => props.provider,
    onSelect: () => {
      pendingPlace = undefined
      dispatch({ type: "dismissed" })
      dialog.close()
    },
  })

  // Memoize and fan out current model key once instead of recomputing selection per row on mount.
  const currentKey = createMemo(() => controller.current())
  const isSelected = createSelector(currentKey)

  const labels = createProviderLabels(controller.all)
  const chatgptPlan = createChatgptPlan(controller.current)
  const usage = createModelUsage({ refresh: true })

  const accounts = createMemo(() =>
    signInAccounts(providerAccounts(integrations.list().find((integration) => integration.id === CONSOLE_INTEGRATION))),
  )

  const go = () => !!labels.group()?.providers.some((provider) => provider.id === "opencode-go")

  // Loaded with the budgets above. Only a workspace the member subscribes to Go in has an allowance.
  const goUsage = () => data.location.usage.limits(location().ref)?.go

  // `navigated`: the arrows have moved through the results since the query last changed.
  const [query, setQuery] = createStore({ search: "", navigated: false })
  const [flyout, setFlyout] = createSignal(createDialogFlyoutState())
  const [flyoutEl, setFlyoutEl] = createSignal<HTMLDivElement>()

  let list: SearchListHandle<ModelRow> | undefined
  let flyoutRef: HTMLDivElement | undefined
  let cachedFlyoutRect: FlyoutRect | undefined
  let pendingPlace: { attempt: number; id: string } | undefined
  let placeScheduled = false
  let scroller: HTMLDivElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let pointer: { x: number; y: number } | undefined

  const sections = createMemo(() =>
    pickerSections({
      groups: controller.groups(controller.models(query.search)),
      all: controller.all(),
      favorites: controller.favorites(),
      recent: controller.recent(),
      searching: query.search.trim().length > 0,
    }),
  )

  // A row that still shows the same model in the same section keeps its object, so a narrower search re-renders none of
  // the rows that stay.
  const rows = createMemo((previous: ModelRow[]) => {
    const kept = new Map(previous.map((row) => [row.id, row]))

    return sections().flatMap((section) =>
      section.items.map((item): ModelRow => {
        const row = kept.get(modelKey(item))

        return row?.item === item &&
          row.section === section.key &&
          row.list === section.list &&
          row.workspace === section.workspace
          ? row
          : { id: modelKey(item), item, section: section.key, list: section.list, workspace: section.workspace }
      }),
    )
  }, [])

  const rowItem = (id: string) => rows().find((row) => row.id === id)?.item
  const flyoutId = createMemo(() => selectFlyoutOpenId(flyout()))

  const flyoutItem = () => {
    const id = flyoutId()

    return id ? rowItem(id) : undefined
  }

  const variantsOf = (item: ModelItem) => Object.keys(item.variants ?? {})
  const favorite = (item: ModelItem) => controller.favorites().some((entry) => modelKey(entry) === modelKey(item))
  const menu = createMemo(() => selectFlyoutMenu(flyout()))
  const menuKeys = createMemo(() => selectFlyoutMenuKeys(flyout()))

  // The flyout's items: Default, then each variant, then Favorite.
  const menuOptions = (item: ModelItem) => [undefined, ...variantsOf(item)]

  const setSearch = (value: string) => {
    setQuery({ search: value, navigated: false })
    dispatch({ type: "keyboard", id: list?.active()?.id, repeat: false })
  }

  // The row moves between Favorites and its group under the same key. From the keys, the highlight and its flyout
  // follow it; from a click, the flyout would be left beside nothing.
  const toggleFavorite = (item: ModelItem, input: "keyboard" | "pointer") => {
    controller.toggleFavorite(item)

    if (input === "pointer") return dispatch({ type: "dismissed" })
    list?.setActive(modelKey(item))
    dispatch({ type: "keyboard", id: modelKey(item), repeat: false })
  }

  const activateMenu = (item: ModelItem, index: number, input: "keyboard" | "pointer") => {
    const options = menuOptions(item)

    if (index < options.length) return controller.select(item, options[index] ?? null)
    toggleFavorite(item, input)
  }

  const manage = async () => {
    const { DialogManageModels } = await import("./manage")
    void dialog.show(() => <DialogManageModels />)
  }

  const connect = async () => {
    const { DialogConnectProvider } = await import("@/providers/connect/dialog")
    // The model chosen after connecting applies to this composer.
    void dialog.show(() => <DialogConnectProvider directory={location().directory} selection={props.model} />)
  }

  // Add account signs in to another OpenCode account; Manage accounts opens OpenCode's accounts.
  const connectOpenCode = async (accounts: boolean) => {
    const { DialogConnectProvider, useProviderConnectController } = await import("@/providers/connect/dialog")
    const controller = useProviderConnectController()
    controller.select(CONSOLE_INTEGRATION)
    void dialog.show(() => (
      <DialogConnectProvider
        directory={location().directory}
        controller={controller}
        accounts={accounts}
        selection={props.model}
      />
    ))
  }

  const flyoutRect = () => cachedFlyoutRect ?? (flyoutRef?.isConnected ? flyoutRef.getBoundingClientRect() : undefined)

  const measure = (id: string) => {
    const row = scroller?.querySelector<HTMLElement>(
      `[data-slot="search-list-row"][data-option-key="${CSS.escape(id)}"]`,
    )

    if (!row?.closest('[data-slot="dialog-container"]')) return undefined
    const rendered = flyoutRef?.isConnected ? flyoutRef : undefined

    const position = placeFlyout(
      row.getBoundingClientRect(),
      row.closest("[data-dialog-layer]")?.getBoundingClientRect(),
      language.direction() === "rtl",
      rendered?.offsetHeight ?? 0,
    )

    if (!rendered) return position
    // A fixed element is placed against the viewport unless an ancestor contains it, as a component preview that holds
    // its dialogs does. Measured against the position it rendered at.
    const rect = rendered.getBoundingClientRect()
    const x = rect.left - parseFloat(rendered.style.left)
    const y = rect.top - parseFloat(rendered.style.top)
    const placed = x || y ? { left: position.left - x, top: position.top - y } : position
    const left = placed.left + x
    const top = placed.top + y
    cachedFlyoutRect = { left, right: left + rect.width, top, bottom: top + rect.height }

    return placed
  }

  const dispatch = (event: DialogFlyoutEvent) => {
    const next = transitionDialogFlyout(untrack(flyout), event)
    setFlyout(next.state)
    next.effects.forEach(runFlyoutEffect)
  }

  const flushPlace = () => {
    placeScheduled = false
    const pending = pendingPlace
    pendingPlace = undefined

    if (!pending || dialog.closing) return

    const state = untrack(flyout)

    if (state.status !== "open" || state.attempt !== pending.attempt) return
    dispatch({ type: "placed", attempt: pending.attempt, position: measure(pending.id) })
  }

  const runFlyoutEffect = (effect: DialogFlyoutEffect) => {
    // Only the pointer activates a row, so a later reorder leaves the list where it is, as for the list's own rows.
    if (effect.type === "activate") return list?.setActive(effect.id, "pointer")

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

    // Coalesce placement into one microtask so ArrowDown (claim + highlight + reveal) measures once after scrolling.
    pendingPlace = { attempt: effect.attempt, id: effect.id }

    if (placeScheduled) return
    placeScheduled = true
    queueMicrotask(flushPlace)
  }

  createEffect(() => {
    if (flyoutItem()) return
    flyoutRef = undefined
    cachedFlyoutRect = undefined
    setFlyoutEl(undefined)
  })

  // Refine placement once the flyout has laid out or its height changes, without forcing a second synchronous layout.
  createResizeObserver(flyoutEl, () => {
    const state = untrack(flyout)

    if (state.status !== "open") return
    dispatch({ type: "placed", attempt: state.attempt, position: measure(state.id) })
  })

  onCleanup(() => {
    clearTimeout(timer)
    pendingPlace = undefined
    dispatch({ type: "disposed" })
  })

  createEventListener(document, "pointermove", (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY }
  })

  type HeaderMetric = {
    header: HTMLElement
    label: HTMLElement | undefined
    labelTop: number
    labelHeight: number
    headerHeight: number
    firstRow: Element | null
    opacity: string
    stuck: boolean
    fade: string
  }

  let viewportEl: HTMLElement | undefined
  let headerMetrics: HeaderMetric[] | undefined
  let headersDirty = false

  const readHeaders = () => {
    const viewport = viewportEl ?? scroller?.querySelector<HTMLElement>('[data-slot="search-list-scroll"]') ?? undefined

    if (!viewport) return undefined
    viewportEl = viewport

    // At the top, before any scroll has faded a label, the first header is the stuck one and nothing is faded. Marking
    // it needs no layout read, so opening the dialog or changing its rows does not measure every header.
    if (!headerMetrics && !headersDirty && viewport.scrollTop === 0) {
      const first = viewport.querySelector<HTMLElement>('[data-slot="search-list-header"]')

      // A header keeps its element while sections come and go above it, such as Favorites.
      viewport
        .querySelectorAll<HTMLElement>('[data-slot="search-list-header"][data-stuck]')
        .forEach((header) => header.toggleAttribute("data-stuck", header === first))
      first?.toggleAttribute("data-stuck", true)

      return undefined
    }

    if (!headerMetrics) {
      headerMetrics = [...viewport.querySelectorAll<HTMLElement>('[data-slot="search-list-header"]')].map((header) => {
        const label = header.querySelector<HTMLElement>('[data-slot="model-dialog-header-label"]') ?? undefined

        return {
          header,
          label,
          labelTop: label?.offsetTop ?? 0,
          labelHeight: label?.offsetHeight ?? 0,
          headerHeight: header.offsetHeight,
          firstRow: header.nextElementSibling,
          opacity: label?.style.opacity || "1",
          stuck: header.hasAttribute("data-stuck"),
          fade: header.style.getPropertyValue("--model-dialog-header-fade") || "0",
        }
      })
    }

    const origin = viewport.getBoundingClientRect().top
    const tops = headerMetrics.map((entry) => entry.header.getBoundingClientRect().top - origin)
    const stuck = tops.findLastIndex((top) => top < 0.5)
    const stuckEntry = stuck >= 0 ? headerMetrics[stuck] : undefined

    // How far the rows under the stuck header have scrolled beneath it, from where its first row rests.
    const hidden =
      stuckEntry && stuckEntry.firstRow
        ? stuckEntry.headerHeight + 4 - (stuckEntry.firstRow.getBoundingClientRect().top - origin)
        : 0

    return { entries: headerMetrics, tops, stuck, hidden }
  }

  const applyHeaders = (measured: ReturnType<typeof readHeaders>) => {
    if (!measured) return

    measured.entries.forEach((entry, index) => {
      if (entry.label) {
        const nextTop = measured.tops[index + 1]
        const nextEntry = measured.entries[index + 1]

        const opacity =
          nextTop === undefined || !nextEntry?.label
            ? "1"
            : String(round(clamp((nextTop + nextEntry.labelTop - entry.labelTop - entry.labelHeight) / 16)))

        if (entry.opacity !== opacity) {
          headersDirty = true
          entry.opacity = opacity
          entry.label.style.setProperty("opacity", opacity)
        }
      }

      const isStuck = index === measured.stuck

      if (entry.stuck !== isStuck) {
        headersDirty = true
        entry.stuck = isStuck
        entry.header.toggleAttribute("data-stuck", isStuck)
      }

      if (!isStuck) return

      const fade = String(round(clamp(measured.hidden / 16)))

      if (entry.fade !== fade) {
        headersDirty = true
        entry.fade = fade
        entry.header.style.setProperty("--model-dialog-header-fade", fade)
      }
    })
  }

  // As on the home page, every header sticks for the whole list, so the next one slides over the stuck one while the
  // stuck label fades out over 16px. The topmost stuck header also fades a gradient in as rows scroll beneath it.
  const fadeHeaders = () => applyHeaders(readHeaders())

  // Scrolling moves rows under a still cursor without a pointer event. All reads (hit-test + header rects) run first on
  // clean layout before any style writes or flyout transitions.
  const onListScroll = () => {
    const followsPointer = selectFlyoutFollowsPointer(untrack(flyout))
    const point = followsPointer ? pointer : undefined

    const row = point
      ? document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-slot="search-list-row"]')
      : undefined

    const id = row?.dataset.optionKey
    const target = point && row && id && scroller?.contains(row) ? { id, point } : undefined
    const measured = readHeaders()

    applyHeaders(measured)
    dispatch({ type: "scrolled", target: followsPointer ? target : undefined })
  }

  // Results that change without a scroll, such as a narrower search, move the headers too.
  createEffect(
    on(rows, () => {
      headerMetrics = undefined
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

  const headerTrigger = (target: EventTarget | null): target is HTMLElement =>
    target instanceof HTMLElement &&
    target.matches('[data-slot="model-dialog-account"], [data-slot="go-meter-trigger"]')

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
    const target = event.target

    // The header's menus, the account switcher and the Go meter, keep focus they got from the keyboard. Closing after a
    // click returns focus to the trigger without the ring, and Kobalte focuses it once more right after, so the field
    // takes focus back once both have run.
    if (headerTrigger(target)) {
      if (!target.matches(":focus-visible"))
        queueMicrotask(() => {
          if (document.activeElement === target) field()?.focus({ preventScroll: true })
        })

      return
    }

    if (inDialog(target) && target !== field() && !searchButton(target)) field()?.focus({ preventScroll: true })
  })

  // The flyout is placed once when it opens, so moving the rows under it closes it instead.
  createEventListener(window, "resize", () => dispatch({ type: "dismissed" }))

  const onKeyDown = (event: KeyboardEvent, active: ModelRow | undefined) => {
    const item = flyoutItem()
    const index = menuKeys()

    // In the flyout's menu, the arrows move through its items until the back arrow returns to the rows.
    if (item && index !== undefined && !event.metaKey && !event.altKey && !event.ctrlKey) {
      const back = language.direction() === "rtl" ? "ArrowRight" : "ArrowLeft"
      const count = menuOptions(item).length + 1

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        const step = event.key === "ArrowDown" ? 1 : -1
        dispatch({ type: "menu.highlighted", index: (index + step + count) % count, input: "keyboard" })

        return
      }

      // Escape leaves the menu, not the dialog (see `data-owns-escape` on the body).
      if (event.key === back || event.key === "Escape") {
        event.preventDefault()
        dispatch({ type: "menu.highlighted", index: undefined, input: "keyboard" })

        return
      }

      if (event.key === "Enter") {
        event.preventDefault()
        activateMenu(item, index, "keyboard")

        return
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") return event.preventDefault()
    }

    if (matchKeybind(favoriteKeybind, event)) {
      if (!active) return
      event.preventDefault()
      toggleFavorite(active.item, "keyboard")

      return
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      setQuery("navigated", true)
      dispatch({ type: "keyboard", id: active?.id, repeat: event.repeat })

      return
    }

    if (event.metaKey || event.altKey || event.ctrlKey) return

    // While searching, the forward arrow edits the query until the arrows have moved through the results.
    const forward = language.direction() === "rtl" ? "ArrowLeft" : "ArrowRight"

    if (event.key === forward && active && (!query.search || query.navigated)) {
      event.preventDefault()
      const options = menuOptions(active.item)
      dispatch({
        type: "menu.entered",
        id: active.id,
        index: Math.max(0, options.indexOf(controller.variant(active.item))),
      })
    }
  }

  const Row = (row: { model: ModelRow; attrs: SearchListRow }) => {
    const item = () => row.model.item
    const selected = () => isSelected(row.model.id)
    const active = () => row.attrs["data-active"] !== undefined
    const budget = createMemo(() => usage(item()))

    return (
      <button
        type="button"
        {...row.attrs}
        // The highlight moves with the arrow keys while the search field keeps focus, so Tab skips the rows and reaches
        // the controls among them, such as the OpenCode account menu.
        tabIndex={-1}
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
            <Icon name="check" />
          </Show>
        </span>
        <span data-slot="model-dialog-name">
          <span class="min-w-0 truncate">
            <SearchHighlight text={item().name} />
          </span>
          {/* Favorites and Recent mix providers, so their rows name one, with its workspace when its header has one. */}
          <Show when={row.model.list === "favorite" || row.model.list === "recent"}>
            <span class="min-w-0 shrink-[999] truncate text-v2-text-text-faint">{labels.name(item().provider)}</span>
            <Show when={labels.workspace(item().provider)}>
              {(workspace) => <Badge class="shrink-0">{workspace()}</Badge>}
            </Show>
          </Show>
          {/* The Free group's header already says so. */}
          <Show when={isFreeModel(item()) && row.model.list !== "free"}>
            <Badge class="shrink-0">{language.t("model.tag.free")}</Badge>
          </Show>
          <Show when={item().latest}>
            <Badge class="shrink-0">{language.t("model.tag.latest")}</Badge>
          </Show>
        </span>
        {/* The active row shows its variant instead; its flyout leads with the budget. */}
        <Show when={!active() && budget()}>
          {(value) => (
            <span data-slot="model-dialog-variant">
              <ModelUsageTag usage={value()} />
              {/* Holds the chevron's space, so the tag ends where the active row's variant label does. */}
              <Icon name="chevron-right" class="invisible" />
            </span>
          )}
        </Show>
        <Show when={active()}>
          <span data-slot="model-dialog-variant">
            <span class="truncate capitalize">{controller.variant(item()) ?? language.t("common.default")}</span>
            <Icon name="chevron-right" />
          </span>
        </Show>
      </button>
    )
  }

  return (
    <Dialog class="command-palette model-dialog" size="large" fit>
      <div class="sr-only">
        <DialogTitle>{language.t("dialog.model.select.title")}</DialogTitle>
      </div>
      <DialogBody class="command-palette-body">
        {/* Scrolling moves the flyout's row away without a pointer event, which would leave it detached. */}
        {/* While the flyout's menu is highlighted, Escape leaves it instead of closing the dialog. */}
        <div
          class="contents"
          data-owns-escape={menuKeys() !== undefined ? "" : undefined}
          ref={(element) => {
            scroller = element
            // A wheel scroll is the pointer's, so the highlight and flyout follow the row under it.
            createEventListener(element, "wheel", () => dispatch({ type: "wheel" }), { passive: true })
            // So is dragging the scrollbar, which would otherwise carry a keyboard flyout away with its row.
            createEventListener(element, "pointerdown", (event: PointerEvent) => {
              if (event.target instanceof Element && event.target.closest('[data-slot="menu-scroll-thumb"]'))
                dispatch({ type: "wheel" })
            })
          }}
        >
          <SearchList
            ref={(handle) => (list = handle)}
            topFade={false}
            onScroll={onListScroll}
            // The flyout follows the highlight while the keyboard drives it, starting with the row the dialog opens on.
            onActive={(row) => dispatch({ type: "highlighted", id: row?.id })}
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
                    icon={<Icon name="plus" />}
                    aria-label={language.t("command.provider.connect")}
                    onClick={connect}
                  />
                </Tooltip>
                <Tooltip placement="top" gutter={4} value={language.t("dialog.model.manage")} ignoreSafeArea={false}>
                  <IconButton
                    variant="ghost-muted"
                    icon={<Icon name="sliders" />}
                    aria-label={language.t("dialog.model.manage")}
                    onClick={manage}
                  />
                </Tooltip>
              </>
            }
            items={rows()}
            key={(row) => row.id}
            section={(row) => row.section}
            header={(row) => (
              <span data-slot="model-dialog-header-label" class="flex min-w-0 flex-1 flex-col">
                <Show when={row.workspace === "lead" && labels.group()}>
                  {(group) => (
                    <WorkspaceHeader
                      workspace={group().workspace}
                      accounts={accounts()}
                      go={go()}
                      usage={goUsage()}
                      onActivate={(account) =>
                        void accountActions.activate({
                          integrationID: CONSOLE_INTEGRATION,
                          provider: language.t("provider.connect.opencode.name"),
                          account,
                        })
                      }
                      onAdd={() => void connectOpenCode(false)}
                      onManage={() => void connectOpenCode(true)}
                      onViewUsage={() => void dialog.show(() => <DialogUsage location={location().ref} />)}
                    />
                  )}
                </Show>
                {/* OpenCode's own models sit right under the group's header, which also heads Go's when they lead. */}
                <Show
                  when={
                    !(
                      row.workspace === "lead" &&
                      (row.item.provider.id === "opencode" || row.item.provider.id === "opencode-go")
                    )
                  }
                >
                  <span
                    data-slot="model-dialog-header-line"
                    data-sub={row.workspace === "lead" ? "" : undefined}
                    class="flex min-w-0 items-center gap-1.5"
                  >
                    <span class="min-w-0 truncate">
                      {row.list
                        ? language.t(listTitles[row.list])
                        : row.workspace && row.item.provider.id === "opencode-go"
                          ? language.t("dialog.model.group.go")
                          : labels.name(row.item.provider)}
                    </span>
                    <Show when={!row.list && labels.workspace(row.item.provider)}>
                      {(workspace) => <Badge class="shrink-0">{workspace()}</Badge>}
                    </Show>
                  </span>
                </Show>
              </span>
            )}
            empty={language.t("dialog.model.empty")}
            onSelect={(row) => controller.select(row.item)}
            onKeyDown={onKeyDown}
          >
            {(row, attrs) => <Row model={row()} attrs={attrs} />}
          </SearchList>
        </div>
        <Show when={chatgptPlan()}>
          <ChatgptPlanFooter />
        </Show>
      </DialogBody>
      {/* Stays in the dialog while the flyout comes and goes: adding or removing a child of the dialog restyles every row. */}
      <div class="contents">
        <Show when={flyoutItem()}>
          {(item) => (
            // Inside the dialog content, so clicks here are not outside clicks that dismiss the dialog.
            <div
              ref={(element) => {
                flyoutRef = element
                setFlyoutEl(element)
              }}
              data-component="menu-v2-content"
              data-slot="model-dialog-flyout"
              style={{
                left: `${selectFlyoutPosition(flyout())?.left ?? 0}px`,
                top: `${selectFlyoutPosition(flyout())?.top ?? 0}px`,
              }}
              onMouseEnter={() => dispatch({ type: "flyout.entered" })}
            >
              <MenuScroll>
                <Show when={usage(item())}>
                  {(value) => (
                    <>
                      <div
                        data-slot="model-dialog-flyout-usage"
                        class="cursor-default px-3 py-1.5 font-[440] tabular-nums select-none"
                      >
                        <div
                          class="text-[13px] leading-5"
                          classList={{
                            "text-v2-state-fg-danger": value().reached,
                            "text-v2-text-text-base": !value().reached,
                          }}
                        >
                          {value().label}
                        </div>
                        <div class="text-[12px] leading-5 text-v2-text-text-muted">
                          {language.t("usage.footer.resets", { time: value().resets })}
                        </div>
                      </div>
                      <div data-slot="menu-v2-separator" role="separator" />
                    </>
                  )}
                </Show>
                {/* A model without variants still lists Default, its only option. */}
                <For each={menuOptions(item())}>
                  {(value, index) => (
                    <div
                      data-component="menu-v2-item"
                      role="menuitemradio"
                      aria-checked={controller.variant(item()) === value}
                      data-checked={controller.variant(item()) === value ? "" : undefined}
                      data-highlighted={menu() === index() ? "" : undefined}
                      onMouseEnter={() => dispatch({ type: "menu.highlighted", index: index(), input: "pointer" })}
                      onMouseLeave={() => dispatch({ type: "menu.highlighted", index: undefined, input: "pointer" })}
                      onClick={() => activateMenu(item(), index(), "pointer")}
                    >
                      <span data-slot="menu-v2-item-content" class="capitalize">
                        {value ?? language.t("common.default")}
                      </span>
                      <span
                        data-slot="menu-v2-item-indicator"
                        data-checked={controller.variant(item()) === value ? "" : undefined}
                      >
                        <Icon name="check" />
                      </span>
                    </div>
                  )}
                </For>
                <div data-slot="menu-v2-separator" role="separator" />
                <div
                  data-component="menu-v2-item"
                  role="menuitem"
                  data-highlighted={menu() === menuOptions(item()).length ? "" : undefined}
                  onMouseEnter={() =>
                    dispatch({ type: "menu.highlighted", index: menuOptions(item()).length, input: "pointer" })
                  }
                  onMouseLeave={() => dispatch({ type: "menu.highlighted", index: undefined, input: "pointer" })}
                  onClick={() => toggleFavorite(item(), "pointer")}
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
                />
              </MenuScroll>
            </div>
          )}
        </Show>
      </div>
    </Dialog>
  )
}
