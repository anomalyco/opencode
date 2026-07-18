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
import { useDialog } from "../ui/dialog"
import { useBindings, formatKeyBindings, useKeymapSelector } from "../keymap"
import { useTuiConfig } from "../config"
import { useConnected } from "./use-connected"
import { DialogProvider } from "./dialog-provider"
import { DialogVariant } from "./dialog-variant"
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
  const [focusedPane, setFocusedPane] = createSignal<"left" | "right">("left")
  const [leftSelected, setLeftSelected] = createSignal(0)
  const [rightSelected, setRightSelected] = createSignal(0)
  const [query, setQuery] = createSignal("")

  const initialMode: RightMode | null = (() => {
    const current = props.current ?? local.model.current()
    if (current) return { kind: "provider", providerID: current.providerID }
    if (sync.data.provider[0]) return { kind: "provider", providerID: sync.data.provider[0].id }
    return null
  })()
  const [rightMode, setRightMode] = createSignal<RightMode | null>(initialMode)

  let leftScroll: ScrollBoxRenderable | undefined
  let rightScroll: ScrollBoxRenderable | undefined
  let input: InputRenderable | undefined

  // ----- Left pane entries -----
  const leftEntries = createMemo<LeftEntry[]>(() => {
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()
    const hidden = local.model.hidden()
    const entries: LeftEntry[] = []
    if (favorites.length) entries.push({ kind: "favorites", count: favorites.length })
    if (recents.length) entries.push({ kind: "recents", count: recents.length })
    if (hidden.length) entries.push({ kind: "hidden", count: hidden.length })
    for (const provider of pipe(sync.data.provider, sortBy(PROVIDER_PIN_FIRST, (p) => p.name))) {
      const count = countVisibleModels(provider)
      if (count > 0) entries.push({ kind: "provider", providerID: provider.id, count })
    }
    if (!connected()) entries.push({ kind: "connect" })
    return entries
  })

  function countVisibleModels(provider: Provider) {
    let n = 0
    for (const [modelID, info] of entries(provider.models)) {
      if (info.status === "deprecated") continue
      if (provider.id === "opencode" && modelID.includes("-nano")) continue
      if (local.model.isHidden({ providerID: provider.id, modelID })) continue
      n++
    }
    return n
  }

  function leftEntryTitle(entry: LeftEntry): string {
    switch (entry.kind) {
      case "favorites":
        return "★ Favorites"
      case "recents":
        return "⟳ Recent"
      case "hidden":
        return "⌧ Hidden"
      case "provider":
        return providerName(entry.providerID)
      case "connect":
        return "+ Connect provider"
    }
  }

  function providerName(providerID: string) {
    return sync.data.provider.find((p) => p.id === providerID)?.name ?? providerID
  }

  // ----- Right pane options -----
  const rightOptions = createMemo<DialogSelectOption<ModelValue>[]>(() => {
    const mode = rightMode()
    if (!mode) return []
    const needle = query().trim().toLowerCase()
    if (mode.kind === "provider") {
      const provider = sync.data.provider.find((p) => p.id === mode.providerID)
      if (!provider) return []
      const visiblePeers = visibleModelsForProvider(provider)
      const rows: DialogSelectOption<ModelValue>[] = []
      for (const [modelID, info] of entries(provider.models)) {
        if (info.status === "deprecated") continue
        if (provider.id === "opencode" && modelID.includes("-nano")) continue
        if (local.model.isHidden({ providerID: provider.id, modelID })) continue
        if (needle && !`${info.name ?? modelID}`.toLowerCase().includes(needle)) continue
        const isFavorite = local.model.favorite().some(
          (f) => f.providerID === provider.id && f.modelID === modelID,
        )
        const note = local.model.note({ providerID: provider.id, modelID })
        const current = props.current ?? local.model.current()
        rows.push(
          modelRow(info, modelID, provider, visiblePeers, rowTheme, {
            favorite: isFavorite,
            note,
            current: current?.providerID === provider.id && current?.modelID === modelID,
            subscription: isSubscriptionFor(provider.id),
            onSelect: () => commitSelect(provider.id, modelID),
          }),
        )
      }
      return rows
    }
    if (mode.kind === "hidden") {
      const hidden = local.model.hidden()
      return hidden.flatMap((item) => {
        const provider = sync.data.provider.find((p) => p.id === item.providerID)
        if (!provider) return []
        const info = provider.models[item.modelID]
        if (!info) return []
        if (needle && !`${info.name ?? item.modelID}`.toLowerCase().includes(needle)) return []
        const note = local.model.note(item)
        return [
          modelRow(info, item.modelID, provider, [info], rowTheme, {
            note,
            subscription: isSubscriptionFor(provider.id),
            onSelect: () => commitSelect(item.providerID, item.modelID),
          }),
        ]
      })
    }
    // favorites / recents
    const items = mode.kind === "favorites" ? local.model.favorite() : local.model.recent()
    return items.flatMap((item) => {
      const provider = sync.data.provider.find((p) => p.id === item.providerID)
      if (!provider) return []
      const info = provider.models[item.modelID]
      if (!info) return []
      if (needle && !`${info.name ?? item.modelID}`.toLowerCase().includes(needle)) return []
      const note = local.model.note(item)
      const current = props.current ?? local.model.current()
      return [
        modelRow(info, item.modelID, provider, [info], rowTheme, {
          favorite: mode.kind === "favorites",
          note,
          current: current?.providerID === item.providerID && current?.modelID === item.modelID,
          subscription: isSubscriptionFor(provider.id),
          onSelect: () => commitSelect(item.providerID, item.modelID),
        }),
      ]
    })
  })

  function visibleModelsForProvider(provider: Provider) {
    const out: (typeof provider.models)[string][] = []
    for (const [modelID, info] of entries(provider.models)) {
      if (info.status === "deprecated") continue
      if (provider.id === "opencode" && modelID.includes("-nano")) continue
      if (local.model.isHidden({ providerID: provider.id, modelID })) continue
      out.push(info)
    }
    return out
  }

  function commitSelect(providerID: string, modelID: string) {
    if (props.onSelect) {
      void props.onSelect(providerID, modelID)
      return
    }
    local.model.set({ providerID, modelID }, { recent: true })
    const list = local.model.variant.list()
    const cur = local.model.variant.selected()
    if (cur === "default" || (cur && list.includes(cur))) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  // ----- Footer actions -----
  const isHiddenMode = createMemo(() => rightMode()?.kind === "hidden")
  const actions = createMemo<Action[]>(() => {
    const list: Action[] = [
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
        title: isHiddenMode() ? "Unhide" : "Hide",
        hidden: !connected(),
        onTrigger() {
          const opt = rightOptions()[rightSelected()]
          if (opt) local.model.toggleHidden(opt.value)
        },
      },
      {
        command: "model.dialog.note",
        title: "Note",
        hidden: !connected(),
        onTrigger() {
          const opt = rightOptions()[rightSelected()]
          if (opt) dialog.replace(() => <DialogNote model={opt.value} />)
        },
      },
      {
        command: "model.dialog.variant",
        title: "Variants",
        hidden: !connected() || isHiddenMode(),
        onTrigger() {
          dialog.replace(() => <DialogVariant />)
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
      .filter((a) => a.label),
  )

  // ----- Navigation -----
  function moveLeft(direction: 1 | -1) {
    const list = leftEntries()
    if (!list.length) return
    let next = leftSelected() + direction
    if (next < 0) next = list.length - 1
    if (next >= list.length) next = 0
    setLeftSelected(next)
    // Preview-on-move: update the right pane to the highlighted provider without stealing focus.
    const entry = list[next]
    if (entry?.kind === "provider") setRightMode({ kind: "provider", providerID: entry.providerID })
    scrollLeftToSelection()
  }

  function moveRight(direction: 1 | -1) {
    const list = rightOptions()
    if (!list.length) return
    let next = rightSelected() + direction
    if (next < 0) next = list.length - 1
    if (next >= list.length) next = 0
    setRightSelected(next)
    scrollRightToSelection()
  }

  function activateLeft() {
    const entry = leftEntries()[leftSelected()]
    if (!entry) return
    if (entry.kind === "favorites") {
      const first = local.model.favorite()[0]
      if (first) commitSelect(first.providerID, first.modelID)
      return
    }
    if (entry.kind === "recents") {
      const first = local.model.recent()[0]
      if (first) commitSelect(first.providerID, first.modelID)
      return
    }
    if (entry.kind === "hidden") {
      setRightMode({ kind: "hidden" })
      setRightSelected(0)
      setFocusedPane("right")
      return
    }
    if (entry.kind === "provider") {
      setRightMode({ kind: "provider", providerID: entry.providerID })
      setRightSelected(0)
      setFocusedPane("right")
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

  function scrollLeftToSelection() {
    if (!leftScroll) return
    const target = leftScroll.getChildren()[leftSelected()]
    if (!target) return
    const y = target.y - leftScroll.y
    if (y >= leftScroll.height) leftScroll.scrollBy(y - leftScroll.height + 1)
    if (y < 0) leftScroll.scrollBy(y)
  }

  function scrollRightToSelection() {
    if (!rightScroll) return
    const target = rightScroll.getChildren()[rightSelected()]
    if (!target) return
    const y = target.y - rightScroll.y
    if (y >= rightScroll.height) rightScroll.scrollBy(y - rightScroll.height + 1)
    if (y < 0) rightScroll.scrollBy(y)
  }

  // Reset right selection when the right pane content changes.
  createMemo(() => {
    rightMode()
    rightOptions()
    setRightSelected(0)
  })

  // ----- Keybindings -----
  useBindings(() => ({
    enabled: () => focusedPane() === "left",
    bindings: [
      { key: "up", desc: "Previous provider", group: "Model dialog", cmd: () => moveLeft(-1) },
      { key: "down", desc: "Next provider", group: "Model dialog", cmd: () => moveLeft(1) },
      { key: "return", desc: "Select provider", group: "Model dialog", cmd: activateLeft },
      { key: "tab", desc: "Focus models pane", group: "Model dialog", cmd: () => setFocusedPane("right") },
    ],
  }))

  useBindings(() => ({
    enabled: () => focusedPane() === "right",
    bindings: [
      { key: "up", desc: "Previous model", group: "Model dialog", cmd: () => moveRight(-1) },
      { key: "down", desc: "Next model", group: "Model dialog", cmd: () => moveRight(1) },
      { key: "return", desc: "Select model", group: "Model dialog", cmd: submitRight },
      { key: "tab", desc: "Focus providers pane", group: "Model dialog", cmd: () => setFocusedPane("left") },
      { key: "shift+tab", desc: "Focus providers pane", group: "Model dialog", cmd: () => setFocusedPane("left") },
    ],
  }))

  // Footer action keybindings (active in either pane).
  useBindings(() => ({
    bindings: shownActions().map((a) => ({
      key: tuiConfig.keybinds.get(a.command)?.[0]?.key ?? a.command,
      desc: a.title,
      group: "Model dialog",
      cmd: a.onTrigger,
    })),
  }))

  // ----- Layout -----
  const title = () => props.title ?? "Select model"
  const currentModel = () => props.current ?? local.model.current()
  const leftWidth = 22
  const listHeight = createMemo(() => Math.max(8, Math.floor(dimensions().height / 2) - 8))

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
          onInput={(e: string) => setQuery(e)}
          focusedBackgroundColor={theme.backgroundPanel}
          cursorColor={theme.primary}
          focusedTextColor={theme.textMuted}
          ref={(r: InputRenderable) => {
            input = r
            input.traits = { status: "FILTER" }
            setTimeout(() => {
              if (!input) return
              if (input.isDestroyed) return
              input.focus()
            }, 1)
          }}
          placeholder="Search models"
          placeholderColor={theme.textMuted}
        />
      </box>

      {/* Two panes */}
      <box flexDirection="row" gap={2} flexGrow={1}>
        {/* Left pane: providers */}
        <box flexDirection="column" flexShrink={0} width={leftWidth}>
          <text fg={theme.textMuted}>Providers</text>
          <scrollbox
            scrollbarOptions={{ visible: false }}
            scrollAcceleration={scrollAcceleration()}
            ref={(r: ScrollBoxRenderable) => (leftScroll = r)}
            maxHeight={listHeight()}
          >
            <For each={leftEntries()}>
              {(entry, index) => {
                const selected = createMemo(
                  () => leftSelected() === index() && focusedPane() === "left",
                )
                const count = () =>
                  entry.kind === "connect" ? undefined : (entry as { count: number }).count
                return (
                  <box
                    flexDirection="row"
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={selected() ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
                    onMouseUp={() => {
                      setLeftSelected(index())
                      setFocusedPane("left")
                      activateLeft()
                    }}
                    onMouseOver={() => {
                      if (focusedPane() !== "left") setFocusedPane("left")
                      setLeftSelected(index())
                    }}
                  >
                    <text
                      fg={selected() ? theme.selectedListItemText : theme.text}
                      attributes={selected() ? TextAttributes.BOLD : undefined}
                      wrapMode="none"
                    >
                      {Locale.truncate(leftEntryTitle(entry), leftWidth - 2)}
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
                      setFocusedPane("right")
                      option.onSelect?.(dialog)
                    }}
                    onMouseOver={() => {
                      if (focusedPane() !== "right") setFocusedPane("right")
                      setRightSelected(idx)
                    }}
                  >
                    <RowContent option={option} active={active()} current={current()} muted={false} />
                  </box>
                )
              }}
            </For>
          </scrollbox>
        </box>
      </box>

      {/* Footer actions */}
      <box paddingRight={2} paddingLeft={0} flexDirection="row" justifyContent="space-between" flexShrink={0}>
        <box flexDirection="row" gap={2}>
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
      </box>
    </box>
  )

  function rightTitle() {
    const mode = rightMode()
    if (!mode) return props.title ?? "Select model"
    if (mode.kind === "provider") return providerName(mode.providerID)
    if (mode.kind === "hidden") return "Hidden models"
    if (mode.kind === "favorites") return "Favorites"
    if (mode.kind === "recents") return "Recent"
    return props.title ?? "Select model"
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
    if (props.active && !props.muted) return fg
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
              <text fg={props.active && !props.muted ? fg : theme.textMuted}>{props.option.footer}</text>
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