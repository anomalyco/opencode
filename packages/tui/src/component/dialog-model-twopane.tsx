import {
  InputRenderable,
  ScrollBoxRenderable,
  TextAttributes,
  RGBA,
  type KeyEvent,
  type Renderable,
} from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { batch, createEffect, createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { pipe, entries, filter, map, sortBy } from "remeda"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { useData } from "../context/data"
import { useTheme, selectedForeground } from "../context/theme"
import { dialogListHeight, useDialog, useDialogLayerActive } from "../ui/dialog"
import { useBindings, formatKeyBindings, useKeymapSelector } from "../keymap"
import { useTuiConfig } from "../config"
import { useConnected } from "./use-connected"
import { DialogProvider } from "./dialog-provider"
import { DialogVariant, listModelVariants } from "./dialog-variant"
import { isSameRightMode, resolveModelSelect, rightPaneContentKey, type RightMode } from "./dialog-model-flow"
import { DialogNote } from "./dialog-note"
import { isSubscriptionProvider, modelRow, type ModelRowTheme } from "../util/model-row"
import { Locale } from "../util/locale"
import { getScrollAcceleration } from "../util/scroll"
import type { Provider } from "@kancode/sdk/v2"
import type { DialogSelectOption } from "../ui/dialog-select"

type ModelValue = { providerID: string; modelID: string }

type LeftEntry =
  | { kind: "favorites"; count: number }
  | { kind: "recents"; count: number }
  | { kind: "hidden"; count: number }
  | { kind: "provider"; providerID: string; count: number }
  | { kind: "connect" }

type LeftRow = { kind: "header"; title: string } | { kind: "item"; entry: LeftEntry; index: number }

interface Action {
  command: string
  title: string
  hidden?: boolean
  disabled?: boolean
  onTrigger: () => void
}

const PROVIDER_PIN_FIRST = (provider: Provider) => provider.id !== "opencode"

export interface DialogModelTwoPaneProps {
  title?: string
  current?: ModelValue
  /** Title-bar label for the active model (or unset fallback). */
  currentLabel?: string
  /** Open with this provider selected in the left pane (e.g. after /connect). */
  initialProviderID?: string
  onSelect?: (providerID: string, modelID: string) => void | Promise<void>
}

export function DialogModelTwoPane(props: DialogModelTwoPaneProps) {
  const local = useLocal()
  const sync = useSync()
  const data = useData()
  const dialog = useDialog()
  const { theme } = useTheme()
  const connected = useConnected()
  const tuiConfig = useTuiConfig()
  const dimensions = useTerminalDimensions()
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  dialog.setSize("xlarge")

  const fg = selectedForeground(theme)
  const rowTheme: ModelRowTheme = {
    text: theme.text,
    textMuted: theme.textMuted,
    success: theme.success,
    warning: theme.warning,
    info: theme.info,
    accent: theme.accent,
  }

  // openai is subscription when connected via ChatGPT Pro/Plus OAuth.
  const openaiSubscription = createMemo(() => {
    const integrations = data.location.integration.list() ?? []
    const openai = integrations.find((item) => item.id === "openai")
    if (!openai) return false
    return openai.connections.some(
      (conn) => conn.type === "credential" && /^chatgpt-(browser|headless)$/.test(conn.id),
    )
  })

  function isSubscriptionFor(providerID: string) {
    if (providerID === "openai") return openaiSubscription()
    return isSubscriptionProvider(providerID)
  }

  // ----- State -----
  // Three-way focus: search is first. Tab toggles search <-> models;
  // ↓ from search enters providers; ↑ on first provider returns to search.
  type Focus = "search" | "left" | "right"
  const [focusedPane, setFocusedPane] = createSignal<Focus>("search")
  const [rightSelected, setRightSelected] = createSignal(0)
  const [query, setQuery] = createSignal("")
  // Keyboard wins until a real mouse move — same pattern as dialog-select.
  // Prevents hover from fighting arrow-key selection when the cursor sits
  // over the list (including synthetic mouseover after layout reflow).
  const [inputMode, setInputMode] = createSignal<"keyboard" | "mouse">("keyboard")
  const dialogActive = useDialogLayerActive()

  function countListableModels(provider: Provider) {
    let n = 0
    for (const [modelID, info] of entries(provider.models)) {
      if (info.status === "deprecated") continue
      if (provider.id === "opencode" && modelID.includes("-nano")) continue
      n++
    }
    return n
  }

  // Open on Favorites; fall back to Recent when Favorites is empty.
  // After connect, prefer the provider the user just added.
  // Counts use visible (non-hidden) refs — same as the left-pane badges.
  const initial = (() => {
    const favorites = connected()
      ? local.model.favorite().filter((item) => !local.model.isHidden(item))
      : []
    const recents = local.model.recent().filter((item) => !local.model.isHidden(item))

    if (props.initialProviderID) {
      // Groups occupy left indices 0..2; providers follow (only those with models).
      let left = 3
      for (const provider of pipe(sync.data.provider, sortBy(PROVIDER_PIN_FIRST, (p) => p.name))) {
        if (countListableModels(provider) === 0) continue
        if (provider.id === props.initialProviderID) {
          return {
            mode: { kind: "provider", providerID: props.initialProviderID } as RightMode,
            left,
          }
        }
        left++
      }
    }
    if (favorites.length) return { mode: { kind: "favorites" } as RightMode, left: 0 }
    if (recents.length) return { mode: { kind: "recents" } as RightMode, left: 1 }
    return { mode: { kind: "favorites" } as RightMode, left: 0 }
  })()
  const [rightMode, setRightMode] = createSignal<RightMode | null>(initial.mode)
  const [leftSelected, setLeftSelected] = createSignal(initial.left)

  let leftScroll: ScrollBoxRenderable | undefined
  let rightScroll: ScrollBoxRenderable | undefined
  let input: InputRenderable | undefined
  let lastRightModeKey = ""

  // Favorites / Recent exclude hidden and catalog-missing refs so the left
  // count matches the right-pane list. Hidden models live only under Hidden.
  function visibleModelRefs(items: ModelValue[]) {
    return items.filter((item) => {
      if (local.model.isHidden(item)) return false
      const provider = sync.data.provider.find((p) => p.id === item.providerID)
      return !!provider?.models[item.modelID]
    })
  }

  function visibleHiddenRefs() {
    return local.model.hidden().filter((item) => {
      const provider = sync.data.provider.find((p) => p.id === item.providerID)
      return !!provider?.models[item.modelID]
    })
  }

  // ----- Left pane entries -----
  // Groups (Favorites / Recent / Hidden) always appear; providers follow.
  const leftEntries = createMemo<LeftEntry[]>(() => {
    const favorites = connected() ? visibleModelRefs(local.model.favorite()) : []
    const recents = visibleModelRefs(local.model.recent())
    const hidden = visibleHiddenRefs()
    const entries: LeftEntry[] = [
      { kind: "favorites", count: favorites.length },
      { kind: "recents", count: recents.length },
      { kind: "hidden", count: hidden.length },
    ]
    for (const provider of pipe(sync.data.provider, sortBy(PROVIDER_PIN_FIRST, (p) => p.name))) {
      const count = countListableModels(provider)
      if (count > 0) entries.push({ kind: "provider", providerID: provider.id, count })
    }
    if (!connected()) entries.push({ kind: "connect" })
    return entries
  })

  const leftRows = createMemo<LeftRow[]>(() => {
    const entries = leftEntries()
    const rows: LeftRow[] = [{ kind: "header", title: "Groups" }]
    let index = 0
    for (const entry of entries) {
      if (entry.kind === "favorites" || entry.kind === "recents" || entry.kind === "hidden") {
        rows.push({ kind: "item", entry, index: index++ })
      }
    }
    rows.push({ kind: "header", title: "Providers" })
    for (const entry of entries) {
      if (entry.kind === "provider" || entry.kind === "connect") {
        rows.push({ kind: "item", entry, index: index++ })
      }
    }
    return rows
  })

  function leftEntryTitle(entry: LeftEntry): string {
    switch (entry.kind) {
      case "favorites":
        return "Favorites"
      case "recents":
        return "Recent"
      case "hidden":
        return "Hidden"
      case "provider":
        return providerName(entry.providerID)
      case "connect":
        return "Connect provider"
    }
  }

  function providerName(providerID: string) {
    return sync.data.provider.find((p) => p.id === providerID)?.name ?? providerID
  }

  // ----- Right pane options -----
  type ModelOption = DialogSelectOption<ModelValue> & { muted?: boolean; note?: string }

  const searching = createMemo(() => query().trim().length > 0)

  function buildModelRow(
    provider: Provider,
    modelID: string,
    info: Provider["models"][string],
    opts?: {
      favorite?: boolean
      showProvider?: boolean
      muted?: boolean
    },
  ): ModelOption {
    const isFavorite =
      opts?.favorite ??
      local.model.favorite().some((f) => f.providerID === provider.id && f.modelID === modelID)
    const note = local.model.note({ providerID: provider.id, modelID })
    const current = props.current
    const row = modelRow(info, modelID, provider, listableModelsForProvider(provider), rowTheme, {
      favorite: isFavorite,
      note,
      current: !!current && current.providerID === provider.id && current.modelID === modelID,
      subscription: isSubscriptionFor(provider.id),
      onSelect: () => commitSelect(provider.id, modelID),
    })
    const titleParts = [row.title]
    if (opts?.showProvider) titleParts.push(provider.name)
    return {
      ...row,
      title: titleParts.join(" · "),
      note: note ? Locale.truncateMiddle(note, 24) : undefined,
      muted: opts?.muted === true,
    }
  }

  type ListedModel = {
    provider: Provider
    modelID: string
    info: Provider["models"][string]
  }

  function listableModelsForProvider(provider: Provider) {
    const out: (typeof provider.models)[string][] = []
    for (const [modelID, info] of entries(provider.models)) {
      if (info.status === "deprecated") continue
      if (provider.id === "opencode" && modelID.includes("-nano")) continue
      out.push(info)
    }
    return out
  }

  // Favorites → recent → others → hidden.
  function sortListedModels(items: ListedModel[]) {
    const favorites = local.model.favorite()
    const recents = local.model.recent()
    const buckets: ListedModel[][] = [[], [], [], []]
    const seen = new Set<string>()

    const keyOf = (item: ListedModel) => `${item.provider.id}/${item.modelID}`
    const take = (ref: ModelValue, bucket: number) => {
      const key = `${ref.providerID}/${ref.modelID}`
      if (seen.has(key)) return
      const match = items.find(
        (item) => item.provider.id === ref.providerID && item.modelID === ref.modelID,
      )
      if (!match) return
      seen.add(key)
      buckets[bucket]!.push(match)
    }

    for (const ref of favorites) take(ref, local.model.isHidden(ref) ? 3 : 0)
    for (const ref of recents) take(ref, local.model.isHidden(ref) ? 3 : 1)

    const rest = items
      .filter((item) => !seen.has(keyOf(item)))
      .sort((a, b) => {
        const an = (a.info.name ?? a.modelID).localeCompare(b.info.name ?? b.modelID)
        if (an !== 0) return an
        return a.provider.name.localeCompare(b.provider.name)
      })
    for (const item of rest) {
      const ref = { providerID: item.provider.id, modelID: item.modelID }
      buckets[local.model.isHidden(ref) ? 3 : 2]!.push(item)
    }

    return buckets.flat()
  }

  function rowsFromListed(items: ListedModel[], showProvider: boolean) {
    return sortListedModels(items).map((item) =>
      buildModelRow(item.provider, item.modelID, item.info, {
        showProvider,
        muted: local.model.isHidden({ providerID: item.provider.id, modelID: item.modelID }),
        favorite: local.model
          .favorite()
          .some((f) => f.providerID === item.provider.id && f.modelID === item.modelID),
      }),
    )
  }

  function searchAllModels(needle: string) {
    const items: ListedModel[] = []
    for (const provider of pipe(sync.data.provider, sortBy(PROVIDER_PIN_FIRST, (p) => p.name))) {
      for (const [modelID, info] of entries(provider.models)) {
        if (info.status === "deprecated") continue
        if (provider.id === "opencode" && modelID.includes("-nano")) continue
        const haystack = `${info.name ?? modelID} ${modelID} ${provider.name}`.toLowerCase()
        if (!haystack.includes(needle)) continue
        items.push({ provider, modelID, info })
      }
    }
    return rowsFromListed(items, true)
  }

  function listProviderModels(provider: Provider) {
    const items: ListedModel[] = []
    for (const [modelID, info] of entries(provider.models)) {
      if (info.status === "deprecated") continue
      if (provider.id === "opencode" && modelID.includes("-nano")) continue
      items.push({ provider, modelID, info })
    }
    return rowsFromListed(items, false)
  }

  const rightOptions = createMemo<ModelOption[]>(() => {
    const needle = query().trim().toLowerCase()
    if (needle) return searchAllModels(needle)

    const mode = rightMode()
    if (!mode) return []
    if (mode.kind === "provider") {
      const provider = sync.data.provider.find((p) => p.id === mode.providerID)
      if (!provider) return []
      return listProviderModels(provider)
    }
    if (mode.kind === "hidden") {
      return visibleHiddenRefs().flatMap((item) => {
        const provider = sync.data.provider.find((p) => p.id === item.providerID)!
        const info = provider.models[item.modelID]!
        return [buildModelRow(provider, item.modelID, info, { showProvider: true, muted: true })]
      })
    }
    // favorites / recents — exclude hidden (they belong under Hidden)
    const items =
      mode.kind === "favorites"
        ? visibleModelRefs(local.model.favorite())
        : visibleModelRefs(local.model.recent())
    return items.flatMap((item) => {
      const provider = sync.data.provider.find((p) => p.id === item.providerID)!
      const info = provider.models[item.modelID]!
      return [
        buildModelRow(provider, item.modelID, info, {
          favorite: mode.kind === "favorites",
          showProvider: true,
        }),
      ]
    })
  })

  function modelHasVariants(model: ModelValue) {
    return listModelVariants(sync.data.provider, model).length > 0
  }

  function openVariantPicker(model: ModelValue) {
    dialog.setSize("medium")
    dialog.push(() => <DialogVariant model={model} onSelect={props.onSelect} />)
  }

  function commitSelect(providerID: string, modelID: string) {
    const action = resolveModelSelect({
      providerID,
      modelID,
      configPicker: !!props.onSelect,
      hasVariants: modelHasVariants({ providerID, modelID }),
    })
    if (action.type === "callback") {
      void props.onSelect?.(action.providerID, action.modelID)
      return
    }
    if (action.type === "open-variants") {
      openVariantPicker(action.model)
      return
    }
    local.model.set(action.model, { recent: true })
    dialog.clear()
  }

  const selectedHasVariants = createMemo(() => {
    const opt = rightOptions()[rightSelected()]
    return !!opt && modelHasVariants(opt.value)
  })

  // ----- Footer actions -----
  const isHiddenMode = createMemo(() => rightMode()?.kind === "hidden")
  const selectedIsHidden = createMemo(() => {
    const opt = rightOptions()[rightSelected()]
    return !!opt && (opt.muted === true || local.model.isHidden(opt.value))
  })
  // `singleKey` marks actions whose shortcut is a bare letter (h/n/v) that
  // would conflict with typing in the search bar. Those are only active when
  // the right pane is focused; modifier-key actions (ctrl+a, ctrl+f) are
  // always active.
  const actions = createMemo<(Action & { singleKey?: boolean })[]>(() => {
    const list: (Action & { singleKey?: boolean })[] = [
      {
        command: "model.dialog.provider",
        title: connected() ? "Connect provider" : "View all providers",
        onTrigger() {
          dialog.replace(() => <DialogProvider />)
        },
      },
      {
        command: "model.dialog.favorite",
        title: "Favorite",
        hidden: !connected() || isHiddenMode(),
        onTrigger() {
          const opt = rightOptions()[rightSelected()]
          if (opt) local.model.toggleFavorite(opt.value)
        },
      },
      {
        command: "model.dialog.hide",
        title: selectedIsHidden() || isHiddenMode() ? "Unhide" : "Hide",
        hidden: !connected(),
        singleKey: true,
        onTrigger() {
          const opt = rightOptions()[rightSelected()]
          if (opt) local.model.toggleHidden(opt.value)
        },
      },
      {
        command: "model.dialog.note",
        title: "Note",
        hidden: !connected(),
        singleKey: true,
        onTrigger() {
          const opt = rightOptions()[rightSelected()]
          if (opt) dialog.push(() => <DialogNote model={opt.value} />)
        },
      },
      {
        command: "model.dialog.variant",
        title: "Variants",
        hidden: !connected() || isHiddenMode() || !selectedHasVariants(),
        singleKey: true,
        onTrigger() {
          const opt = rightOptions()[rightSelected()]
          if (opt) openVariantPicker(opt.value)
        },
      },
    ]
    return list
  })

  const shownActions = createMemo(() => actions().filter((a) => !a.hidden))
  const actionBindings = useKeymapSelector((keymap) =>
    keymap.getCommandBindings({
      visibility: "registered",
      commands: shownActions().map((a) => a.command),
    }),
  )
  const actionLabels = createMemo(() => {
    const labels = new Map<string, string>()
    for (const a of shownActions()) {
      const label = formatKeyBindings(actionBindings().get(a.command), tuiConfig)
      if (label) labels.set(a.command, label)
    }
    return labels
  })
  const visibleActions = createMemo(() =>
    shownActions()
      .map((a) => ({ ...a, label: actionLabels().get(a.command) ?? "" }))
      .filter((a) => a.label)
      // Hide single-key shortcuts (h/n/v) unless the right pane is focused;
      // modifier-key actions (ctrl+a, ctrl+f) stay visible in all states.
      .filter((a) => !a.singleKey || focusedPane() === "right"),
  )

  // ----- Navigation -----
  function previewLeft(index: number) {
    const entry = leftEntries()[index]
    if (!entry) return
    // Skip no-op mode writes so hovering the same provider does not rebuild a
    // long model list (e.g. OpenRouter) or reset scroll under the cursor.
    if (entry.kind === "provider") {
      const next: RightMode = { kind: "provider", providerID: entry.providerID }
      if (!isSameRightMode(rightMode(), next)) setRightMode(next)
      return
    }
    if (entry.kind === "favorites") {
      if (!isSameRightMode(rightMode(), { kind: "favorites" })) setRightMode({ kind: "favorites" })
      return
    }
    if (entry.kind === "recents") {
      if (!isSameRightMode(rightMode(), { kind: "recents" })) setRightMode({ kind: "recents" })
      return
    }
    if (entry.kind === "hidden") {
      if (!isSameRightMode(rightMode(), { kind: "hidden" })) setRightMode({ kind: "hidden" })
    }
  }

  function resetRightViewport() {
    setRightSelected(0)
    // Layout reflow under a stationary cursor can emit synthetic mouseover on
    // the new long list — stay in keyboard mode until a real mouse move.
    setInputMode("keyboard")
    if (rightScroll && !rightScroll.isDestroyed) rightScroll.scrollTo(0)
  }

  function moveLeft(direction: 1 | -1) {
    setInputMode("keyboard")
    const list = leftEntries()
    if (!list.length) return
    const next = leftSelected() + direction
    // Arrow up on the first group item returns to the search bar.
    if (next < 0) {
      focusSearch()
      return
    }
    if (next >= list.length) return
    setLeftSelected(next)
    previewLeft(next)
    scrollLeftToSelection()
  }

  function moveRight(direction: 1 | -1) {
    setInputMode("keyboard")
    const list = rightOptions()
    if (!list.length) return
    const next = rightSelected() + direction
    // While searching, ↑ on the first result returns to the search bar.
    if (next < 0) {
      if (searching()) focusSearch()
      return
    }
    if (next >= list.length) return
    setRightSelected(next)
    scrollRightToSelection()
  }

  function focusProviders() {
    setInputMode("keyboard")
    focusPane("left")
    previewLeft(leftSelected())
    scrollLeftToSelection()
  }

  function hoverLeft(index: number) {
    setLeftSelected(index)
    focusPane("left")
    previewLeft(index)
  }

  function hoverRight(index: number) {
    setRightSelected(index)
    focusPane("right")
  }

  function activateLeft() {
    const entry = leftEntries()[leftSelected()]
    if (!entry) return
    if (entry.kind === "favorites") {
      if (!isSameRightMode(rightMode(), { kind: "favorites" })) setRightMode({ kind: "favorites" })
      resetRightViewport()
      focusPane("right")
      return
    }
    if (entry.kind === "recents") {
      if (!isSameRightMode(rightMode(), { kind: "recents" })) setRightMode({ kind: "recents" })
      resetRightViewport()
      focusPane("right")
      return
    }
    if (entry.kind === "hidden") {
      if (!isSameRightMode(rightMode(), { kind: "hidden" })) setRightMode({ kind: "hidden" })
      resetRightViewport()
      focusPane("right")
      return
    }
    if (entry.kind === "provider") {
      const next: RightMode = { kind: "provider", providerID: entry.providerID }
      if (!isSameRightMode(rightMode(), next)) setRightMode(next)
      resetRightViewport()
      focusPane("right")
      return
    }
    if (entry.kind === "connect") {
      dialog.replace(() => <DialogProvider />)
      return
    }
  }

  function submitRight() {
    const opt = rightOptions()[rightSelected()]
    if (opt) opt.onSelect?.(dialog)
  }

  // Focus helpers: blur the search input whenever focus leaves it so
  // typed keys go to pane navigation instead of the filter.
  function blurSearch() {
    if (input && !input.isDestroyed && input.focused) input.blur()
  }

  function focusSearch() {
    setFocusedPane("search")
    if (input && !input.isDestroyed) input.focus()
  }

  function focusPane(pane: "left" | "right") {
    blurSearch()
    setFocusedPane(pane)
  }

  // Tab: search -> models; from providers/models -> search.
  function tabForward() {
    setInputMode("keyboard")
    if (focusedPane() === "search") focusPane("right")
    else focusSearch()
  }

  function tabBackward() {
    setInputMode("keyboard")
    if (focusedPane() === "search") focusProviders()
    else focusSearch()
  }

  // When the filter changes, layout can reflow under a stationary cursor and
  // emit synthetic mouseover — keep keyboard mode so hover does not steal.
  createEffect(() => {
    query()
    setInputMode("keyboard")
  })

  // After a nested dialog (Note) closes, this layer becomes active again.
  // Keep the caret off the filter unless search is the focused pane.
  createEffect(() => {
    if (!dialogActive()) return
    if (focusedPane() !== "search") blurSearch()
  })

  function scrollChildIntoView(scroll: ScrollBoxRenderable, target: Renderable) {
    const y = target.y - scroll.y
    // Use the full row height so multi-line model rows aren't clipped at the bottom.
    if (y + target.height > scroll.height) scroll.scrollBy(y + target.height - scroll.height)
    if (y < 0) scroll.scrollBy(y)
  }

  function scrollLeftToSelection() {
    if (!leftScroll) return
    const rowIndex = leftRows().findIndex((row) => row.kind === "item" && row.index === leftSelected())
    if (rowIndex < 0) return
    const target = leftScroll.getChildren()[rowIndex]
    if (target) scrollChildIntoView(leftScroll, target)
  }

  function scrollRightToSelection() {
    if (!rightScroll) return
    const target = rightScroll.getChildren()[rightSelected()]
    if (target) scrollChildIntoView(rightScroll, target)
  }

  // Reset selection + scroll when the right-pane mode or search query changes.
  // Long providers (OpenRouter) keep a deep scroll offset otherwise, so the
  // highlighted row (index 0) is off-screen after hovering another provider.
  // When a model is hidden/removed, keep the cursor index so it lands on the next model.
  createMemo(() => {
    const key = rightPaneContentKey({
      mode: rightMode(),
      searching: searching(),
      query: query(),
    })
    if (key !== lastRightModeKey) {
      lastRightModeKey = key
      resetRightViewport()
    }
    const len = rightOptions().length
    if (len > 0 && rightSelected() >= len) setRightSelected(len - 1)
  })

  // ----- Keybindings -----
  // Gate on dialogActive so a covered layer (e.g. under Note) cannot steal keys.
  useBindings(() => ({
    enabled: () => dialogActive(),
    bindings: [
      { key: "tab", desc: "Focus search or models", group: "Model dialog", cmd: tabForward },
      { key: "shift+tab", desc: "Focus search or providers", group: "Model dialog", cmd: tabBackward },
    ],
  }))

  // From search: ↓ enters results when filtering has matches; otherwise providers.
  useBindings(() => ({
    enabled: () => dialogActive() && focusedPane() === "search",
    bindings: [
      {
        key: "down",
        desc: "Focus list",
        group: "Model dialog",
        cmd: () => {
          setInputMode("keyboard")
          if (searching() && rightOptions().length > 0) focusPane("right")
          else focusProviders()
        },
      },
    ],
  }))

  // Arrow Left/Right switch between left and right panes (from either pane).
  useBindings(() => ({
    enabled: () => dialogActive() && (focusedPane() === "left" || focusedPane() === "right"),
    bindings: [
      { key: "left", desc: "Focus providers pane", group: "Model dialog", cmd: focusProviders },
      {
        key: "right",
        desc: "Focus models pane",
        group: "Model dialog",
        cmd: () => {
          setInputMode("keyboard")
          focusPane("right")
        },
      },
    ],
  }))

  // Left pane: up/down move, enter activates.
  useBindings(() => ({
    enabled: () => dialogActive() && focusedPane() === "left",
    bindings: [
      { key: "up", desc: "Previous provider", group: "Model dialog", cmd: () => moveLeft(-1) },
      { key: "down", desc: "Next provider", group: "Model dialog", cmd: () => moveLeft(1) },
      { key: "return", desc: "Select provider", group: "Model dialog", cmd: activateLeft },
    ],
  }))

  // Right pane: up/down move, enter selects model.
  useBindings(() => ({
    enabled: () => dialogActive() && focusedPane() === "right",
    bindings: [
      { key: "up", desc: "Previous model", group: "Model dialog", cmd: () => moveRight(-1) },
      { key: "down", desc: "Next model", group: "Model dialog", cmd: () => moveRight(1) },
      { key: "return", desc: "Select model", group: "Model dialog", cmd: submitRight },
    ],
  }))

  // Footer action keybindings. Register as named commands so
  // getCommandBindings resolves their labels for the footer.
  // Modifier-key actions (ctrl+a, ctrl+f) are always active; single-key
  // actions (h, n, v) are only active when the right pane is focused so
  // they don't conflict with typing in the search bar.
  const modifierActions = createMemo(() => shownActions().filter((a) => !a.singleKey))
  const singleKeyActions = createMemo(() => shownActions().filter((a) => a.singleKey))

  useBindings(() => {
    const visible = modifierActions()
    return {
      enabled: () => dialogActive(),
      commands: visible.map((a) => ({
        name: a.command,
        title: a.title,
        category: "Model dialog",
        run() {
          a.onTrigger()
        },
      })),
      bindings: visible.flatMap((a) => tuiConfig.keybinds.get(a.command)),
    }
  })

  useBindings(() => ({
    enabled: () => dialogActive() && focusedPane() === "right",
    commands: singleKeyActions().map((a) => ({
      name: a.command,
      title: a.title,
      category: "Model dialog",
      run() {
        a.onTrigger()
      },
    })),
    bindings: singleKeyActions().flatMap((a) => tuiConfig.keybinds.get(a.command)),
  }))

  // ----- Layout -----
  const title = () => props.title ?? "Select model"
  const currentModel = () => props.current
  const leftWidth = 24
  const listHeight = createMemo(() => dialogListHeight("xlarge", dimensions().height))
  const focusHint = createMemo(() => {
    switch (focusedPane()) {
      case "search":
        return searching() && rightOptions().length > 0
          ? "tab models · ↓ results"
          : "tab models · ↓ providers"
      case "left":
        return "tab search · ←/→ pane · ↑ search · enter open"
      case "right":
        return searching()
          ? "tab search · ↑ search · enter select"
          : "tab search · ←/→ pane · enter select"
    }
  })

  return (
    <box paddingLeft={4} paddingRight={4} paddingBottom={1} flexDirection="column" gap={1}>
      {/* Title bar */}
      <box flexDirection="row" justifyContent="space-between" gap={1}>
        <box flexDirection="row" flexGrow={1} gap={2} overflow="hidden">
          <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="none">
            {title()}
          </text>
          <Show when={props.currentLabel}>
            <text fg={theme.textMuted} wrapMode="none">
              {props.currentLabel}
            </text>
          </Show>
        </box>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      {/* Shared search input */}
      <box paddingTop={1}>
        <input
          onInput={(e: string) => {
            setQuery(e)
            setInputMode("keyboard")
            if (focusedPane() !== "search") setFocusedPane("search")
          }}
          focusedBackgroundColor={theme.backgroundPanel}
          cursorColor={theme.primary}
          focusedTextColor={theme.textMuted}
          ref={(r: InputRenderable) => {
            input = r
            input.traits = { status: "FILTER" }
            setTimeout(() => {
              if (!input) return
              if (input.isDestroyed) return
              focusSearch()
            }, 1)
          }}
          placeholder="Search models"
          placeholderColor={theme.textMuted}
        />
      </box>

      {/* Two panes */}
      <box flexDirection="row" gap={2} flexGrow={1}>
        {/* Left pane: Groups + Providers */}
        <box flexDirection="column" flexShrink={0} width={leftWidth}>
          <scrollbox
            scrollbarOptions={{ visible: false }}
            scrollAcceleration={scrollAcceleration()}
            ref={(r: ScrollBoxRenderable) => {
              leftScroll = r
              if (props.initialProviderID) {
                setTimeout(() => {
                  if (!leftScroll) return
                  scrollLeftToSelection()
                }, 1)
              }
            }}
            maxHeight={listHeight()}
          >
            <For each={leftRows()}>
              {(row) => {
                if (row.kind === "header") {
                  return (
                    <box paddingLeft={1} paddingRight={1} paddingTop={row.title === "Providers" ? 1 : 0}>
                      <text fg={theme.textMuted} attributes={TextAttributes.BOLD} wrapMode="none">
                        {row.title}
                      </text>
                    </box>
                  )
                }
                const selected = createMemo(
                  () => leftSelected() === row.index && focusedPane() === "left",
                )
                const count = () =>
                  row.entry.kind === "connect" ? undefined : (row.entry as { count: number }).count
                return (
                  <box
                    flexDirection="row"
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={selected() ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
                    onMouseMove={() => setInputMode("mouse")}
                    onMouseDown={() => hoverLeft(row.index)}
                    onMouseOver={() => {
                      if (inputMode() !== "mouse") return
                      hoverLeft(row.index)
                    }}
                    onMouseUp={() => {
                      hoverLeft(row.index)
                      activateLeft()
                    }}
                  >
                    <text
                      fg={selected() ? theme.selectedListItemText : theme.text}
                      attributes={selected() ? TextAttributes.BOLD : undefined}
                      wrapMode="none"
                    >
                      {Locale.truncate(leftEntryTitle(row.entry), leftWidth - 2)}
                    </text>
                    <Show when={count() !== undefined}>
                      <text fg={selected() ? theme.selectedListItemText : theme.textMuted}>
                        {" "}
                        {String(count())}
                      </text>
                    </Show>
                  </box>
                )
              }}
            </For>
          </scrollbox>
        </box>

        {/* Right pane: models */}
        <box flexDirection="column" flexGrow={1} flexShrink={1}>
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
            {rightTitle()}
          </text>
          <Show
            when={rightOptions().length > 0}
            fallback={
              <box paddingLeft={1} paddingTop={1}>
                <text fg={theme.textMuted}>{emptyRightMessage()}</text>
              </box>
            }
          >
            <scrollbox
              scrollbarOptions={{ visible: false }}
              scrollAcceleration={scrollAcceleration()}
              ref={(r: ScrollBoxRenderable) => (rightScroll = r)}
              maxHeight={listHeight()}
            >
              <For each={rightOptions()}>
                {(option, index) => {
                  // Use For's index — avoid indexOf on long lists (OpenRouter).
                  const active = createMemo(
                    () => rightSelected() === index() && focusedPane() === "right",
                  )
                  const current = createMemo(() => {
                    const c = currentModel()
                    return !!c && c.providerID === option.value.providerID && c.modelID === option.value.modelID
                  })
                  return (
                    <box
                      flexDirection="column"
                      paddingLeft={1}
                      paddingRight={1}
                      backgroundColor={active() ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
                      onMouseMove={() => setInputMode("mouse")}
                      onMouseDown={() => hoverRight(index())}
                      onMouseOver={() => {
                        if (inputMode() !== "mouse") return
                        hoverRight(index())
                      }}
                      onMouseUp={() => {
                        hoverRight(index())
                        option.onSelect?.(dialog)
                      }}
                    >
                      <RowContent
                        option={option}
                        active={active()}
                        current={current()}
                        muted={option.muted === true}
                      />
                    </box>
                  )
                }}
              </For>
            </scrollbox>
          </Show>
        </box>
      </box>

      {/* Footer: actions + focus hints */}
      <box paddingRight={2} paddingLeft={0} flexDirection="row" justifyContent="space-between" flexShrink={0} gap={2}>
        <box flexDirection="row" gap={2} flexShrink={1}>
          <For each={visibleActions()}>
            {(item) => (
              <text>
                <span style={{ fg: theme.text }}>
                  <b>{item.title}</b>{" "}
                </span>
                <span style={{ fg: theme.textMuted }}>{item.label}</span>
              </text>
            )}
          </For>
        </box>
        <text fg={theme.textMuted} flexShrink={0}>
          {focusHint()}
        </text>
      </box>
    </box>
  )

  function rightTitle() {
    if (searching()) return `Search · ${rightOptions().length}`
    const mode = rightMode()
    if (!mode) return props.title ?? "Select model"
    if (mode.kind === "provider") return providerName(mode.providerID)
    if (mode.kind === "hidden") return "Hidden"
    if (mode.kind === "favorites") return "Favorites"
    if (mode.kind === "recents") return "Recent"
    return props.title ?? "Select model"
  }

  function emptyRightMessage() {
    if (searching()) return "No models match your search."
    const mode = rightMode()
    if (mode?.kind === "favorites") return "No favorites yet. Select a model and press ctrl+f to favorite it."
    if (mode?.kind === "recents") return "No recent models."
    if (mode?.kind === "hidden") return "No hidden models."
    return "No models found."
  }
}

// Render a model row's title + footer + details, matching DialogSelect.Option's look.
function RowContent(props: {
  option: DialogSelectOption<ModelValue> & { note?: string }
  active: boolean
  current: boolean
  muted: boolean
}) {
  const { theme } = useTheme()
  const fg = selectedForeground(theme)
  const text = createMemo(() => {
    if (props.active) return fg
    if (props.muted) return theme.textMuted
    if (props.current) return theme.primary
    return theme.text
  })
  const noteColor = createMemo(() => {
    if (props.active) return fg
    if (props.muted) return theme.textMuted
    return theme.info
  })
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1}>
        <Show when={props.current}>
          <text flexShrink={0} fg={text()}>
            ●
          </text>
        </Show>
        <box flexGrow={1} flexDirection="row" overflow="hidden">
          <text
            fg={text()}
            attributes={props.active && !props.muted ? TextAttributes.BOLD : undefined}
            wrapMode="none"
          >
            {props.option.title}
          </text>
          <Show when={props.option.note}>
            <text fg={noteColor()} wrapMode="none">
              {" · "}
              {props.option.note}
            </text>
          </Show>
        </box>
        <Show when={props.option.footer}>
          <box flexShrink={0}>
            <Show
              when={typeof props.option.footer === "string"}
              fallback={<>{props.option.footer}</>}
            >
              <text fg={props.active ? fg : theme.textMuted}>{props.option.footer}</text>
            </Show>
          </box>
        </Show>
      </box>
      <For each={props.option.details}>
        {(detail) => (
          <text fg={theme.textMuted} wrapMode="none">
            {Locale.truncateMiddle(detail, 76)}
          </text>
        )}
      </For>
    </box>
  )
}