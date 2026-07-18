import {
  InputRenderable,
  ScrollBoxRenderable,
  TextAttributes,
  RGBA,
  type KeyEvent,
  type Renderable,
} from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { batch, createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { pipe, entries, filter, map, sortBy } from "remeda"
import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { useData } from "../context/data"
import { useTheme, selectedForeground } from "../context/theme"
import { dialogListHeight, useDialog } from "../ui/dialog"
import { useBindings, formatKeyBindings, useKeymapSelector } from "../keymap"
import { useTuiConfig } from "../config"
import { useConnected } from "./use-connected"
import { DialogProvider } from "./dialog-provider"
import { DialogVariant, listModelVariants } from "./dialog-variant"
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

type RightMode =
  | { kind: "provider"; providerID: string }
  | { kind: "hidden" }
  | { kind: "favorites" }
  | { kind: "recents" }

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

  // Open on Favorites; fall back to Recent when Favorites is empty.
  const initial = (() => {
    const favorites = connected() ? local.model.favorite() : []
    if (favorites.length) return { mode: { kind: "favorites" } as RightMode, left: 0 }
    const recents = local.model.recent()
    if (recents.length) return { mode: { kind: "recents" } as RightMode, left: 1 }
    return { mode: { kind: "favorites" } as RightMode, left: 0 }
  })()
  const [rightMode, setRightMode] = createSignal<RightMode | null>(initial.mode)
  const [leftSelected, setLeftSelected] = createSignal(initial.left)

  let leftScroll: ScrollBoxRenderable | undefined
  let rightScroll: ScrollBoxRenderable | undefined
  let input: InputRenderable | undefined
  let lastRightModeKey = ""

  // ----- Left pane entries -----
  // Groups (Favorites / Recent / Hidden) always appear; providers follow.
  const leftEntries = createMemo<LeftEntry[]>(() => {
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()
    const hidden = local.model.hidden()
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

  function countListableModels(provider: Provider) {
    let n = 0
    for (const [modelID, info] of entries(provider.models)) {
      if (info.status === "deprecated") continue
      if (provider.id === "opencode" && modelID.includes("-nano")) continue
      n++
    }
    return n
  }

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
  type ModelOption = DialogSelectOption<ModelValue> & { muted?: boolean }

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
    const current = props.current ?? local.model.current()
    const row = modelRow(info, modelID, provider, listableModelsForProvider(provider), rowTheme, {
      favorite: isFavorite,
      note,
      current: current?.providerID === provider.id && current?.modelID === modelID,
      subscription: isSubscriptionFor(provider.id),
      onSelect: () => commitSelect(provider.id, modelID),
    })
    return {
      ...row,
      title: opts?.showProvider ? `${row.title} · ${provider.name}` : row.title,
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
      return local.model.hidden().flatMap((item) => {
        const provider = sync.data.provider.find((p) => p.id === item.providerID)
        if (!provider) return []
        const info = provider.models[item.modelID]
        if (!info) return []
        return [buildModelRow(provider, item.modelID, info, { showProvider: true, muted: true })]
      })
    }
    // favorites / recents
    const items = mode.kind === "favorites" ? local.model.favorite() : local.model.recent()
    return items.flatMap((item) => {
      const provider = sync.data.provider.find((p) => p.id === item.providerID)
      if (!provider) return []
      const info = provider.models[item.modelID]
      if (!info) return []
      return [
        buildModelRow(provider, item.modelID, info, {
          favorite: mode.kind === "favorites",
          showProvider: true,
          muted: local.model.isHidden(item),
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
    if (props.onSelect) {
      void props.onSelect(providerID, modelID)
      return
    }
    const model = { providerID, modelID }
    if (modelHasVariants(model)) {
      openVariantPicker(model)
      return
    }
    local.model.set(model, { recent: true })
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
          if (opt) dialog.replace(() => <DialogNote model={opt.value} />)
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
    if (entry.kind === "provider") setRightMode({ kind: "provider", providerID: entry.providerID })
    else if (entry.kind === "favorites") setRightMode({ kind: "favorites" })
    else if (entry.kind === "recents") setRightMode({ kind: "recents" })
    else if (entry.kind === "hidden") setRightMode({ kind: "hidden" })
  }

  function moveLeft(direction: 1 | -1) {
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
    focusPane("left")
    previewLeft(leftSelected())
    scrollLeftToSelection()
  }

  function activateLeft() {
    const entry = leftEntries()[leftSelected()]
    if (!entry) return
    if (entry.kind === "favorites") {
      setRightMode({ kind: "favorites" })
      setRightSelected(0)
      focusPane("right")
      return
    }
    if (entry.kind === "recents") {
      setRightMode({ kind: "recents" })
      setRightSelected(0)
      focusPane("right")
      return
    }
    if (entry.kind === "hidden") {
      setRightMode({ kind: "hidden" })
      setRightSelected(0)
      focusPane("right")
      return
    }
    if (entry.kind === "provider") {
      setRightMode({ kind: "provider", providerID: entry.providerID })
      setRightSelected(0)
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
    if (focusedPane() === "search") focusPane("right")
    else focusSearch()
  }

  function tabBackward() {
    if (focusedPane() === "search") focusProviders()
    else focusSearch()
  }

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

  // Reset selection when the right-pane mode or search query changes. When a
  // model is hidden/removed, keep the cursor index so it lands on the next model.
  createMemo(() => {
    const mode = rightMode()
    const modeKey = !mode ? "" : mode.kind === "provider" ? `provider:${mode.providerID}` : mode.kind
    const key = searching() ? `search:${query().trim().toLowerCase()}` : modeKey
    if (key !== lastRightModeKey) {
      lastRightModeKey = key
      setRightSelected(0)
    }
    const len = rightOptions().length
    if (len > 0 && rightSelected() >= len) setRightSelected(len - 1)
  })

  // ----- Keybindings -----
  useBindings(() => ({
    bindings: [
      { key: "tab", desc: "Focus search or models", group: "Model dialog", cmd: tabForward },
      { key: "shift+tab", desc: "Focus search or providers", group: "Model dialog", cmd: tabBackward },
    ],
  }))

  // From search: ↓ enters models when filtering, otherwise providers.
  useBindings(() => ({
    enabled: () => focusedPane() === "search",
    bindings: [
      {
        key: "down",
        desc: "Focus list",
        group: "Model dialog",
        cmd: () => {
          if (searching()) focusPane("right")
          else focusProviders()
        },
      },
    ],
  }))

  // Arrow Left/Right switch between left and right panes (from either pane).
  useBindings(() => ({
    enabled: () => focusedPane() === "left" || focusedPane() === "right",
    bindings: [
      { key: "left", desc: "Focus providers pane", group: "Model dialog", cmd: focusProviders },
      { key: "right", desc: "Focus models pane", group: "Model dialog", cmd: () => focusPane("right") },
    ],
  }))

  // Left pane: up/down move, enter activates.
  useBindings(() => ({
    enabled: () => focusedPane() === "left",
    bindings: [
      { key: "up", desc: "Previous provider", group: "Model dialog", cmd: () => moveLeft(-1) },
      { key: "down", desc: "Next provider", group: "Model dialog", cmd: () => moveLeft(1) },
      { key: "return", desc: "Select provider", group: "Model dialog", cmd: activateLeft },
    ],
  }))

  // Right pane: up/down move, enter selects model.
  useBindings(() => ({
    enabled: () => focusedPane() === "right",
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
    enabled: () => focusedPane() === "right",
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
  const currentModel = () => props.current ?? local.model.current()
  const leftWidth = 24
  const listHeight = createMemo(() => dialogListHeight("xlarge", dimensions().height))
  const focusHint = createMemo(() => {
    switch (focusedPane()) {
      case "search":
        return searching() ? "tab models · ↓ results" : "tab models · ↓ providers"
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
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {title()}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      {/* Shared search input */}
      <box paddingTop={1}>
        <input
          onInput={(e: string) => {
            setQuery(e)
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
            ref={(r: ScrollBoxRenderable) => (leftScroll = r)}
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
                    onMouseUp={() => {
                      setLeftSelected(row.index)
                      focusPane("left")
                      activateLeft()
                    }}
                    onMouseOver={() => {
                      if (focusedPane() !== "left") focusPane("left")
                      setLeftSelected(row.index)
                      const entry = row.entry
                      if (entry.kind === "provider") setRightMode({ kind: "provider", providerID: entry.providerID })
                      else if (entry.kind === "favorites") setRightMode({ kind: "favorites" })
                      else if (entry.kind === "recents") setRightMode({ kind: "recents" })
                      else if (entry.kind === "hidden") setRightMode({ kind: "hidden" })
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
                {(option) => {
                  const idx = rightOptions().indexOf(option)
                  const active = createMemo(
                    () => rightSelected() === idx && focusedPane() === "right",
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
                      onMouseUp={() => {
                        setRightSelected(idx)
                        focusPane("right")
                        option.onSelect?.(dialog)
                      }}
                      onMouseOver={() => {
                        if (focusedPane() !== "right") focusPane("right")
                        setRightSelected(idx)
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
    const mode = rightMode()
    if (mode?.kind === "favorites") return "No favorites yet. Select a model and press ctrl+f to favorite it."
    if (mode?.kind === "recents") return "No recent models."
    if (mode?.kind === "hidden") return "No hidden models."
    if (query().trim()) return "No models match your search."
    return "No models found."
  }
}

// Render a model row's title + footer + details, matching DialogSelect.Option's look.
function RowContent(props: {
  option: DialogSelectOption<ModelValue>
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
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1}>
        <Show when={props.current}>
          <text flexShrink={0} fg={text()}>
            ●
          </text>
        </Show>
        <text
          flexGrow={1}
          fg={text()}
          attributes={props.active && !props.muted ? TextAttributes.BOLD : undefined}
          overflow="hidden"
          wrapMode="none"
        >
          {props.option.title}
        </text>
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