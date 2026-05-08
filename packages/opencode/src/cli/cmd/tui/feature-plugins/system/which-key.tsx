/** @jsxImportSource @opentui/solid */
import { RGBA, TextAttributes, type KeyEvent, type Renderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { useBindings, useKeymapSelector } from "../../keymap"
import type { ActiveKey } from "@opentui/keymap"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"

const command = {
  toggle: "tui-which-key.toggle",
  toggleLayout: "tui-which-key.layout.toggle",
  togglePending: "tui-which-key.pending.toggle",
  groupPrevious: "tui-which-key.group.previous",
  groupNext: "tui-which-key.group.next",
  scrollUp: "tui-which-key.scroll.up",
  scrollDown: "tui-which-key.scroll.down",
  pageUp: "tui-which-key.page.up",
  pageDown: "tui-which-key.page.down",
  home: "tui-which-key.home",
  end: "tui-which-key.end",
} as const

const LAYER_PRIORITY = 900
const KV_LAYOUT = "which_key_layout"
const KV_PENDING_PREVIEW = "which_key_pending_preview"
const toggleCommands = [command.toggle, command.toggleLayout, command.togglePending] as const
const scrollCommands = [
  command.scrollUp,
  command.scrollDown,
  command.pageUp,
  command.pageDown,
  command.home,
  command.end,
] as const
const panelCommands = [command.groupPrevious, command.groupNext, ...scrollCommands] as const
const COLUMN_GAP = 4
const TAB_GAP = 3
const MIN_TAB_GAP = 1
const TAB_CONTENT_GAP = 1
const MIN_COLUMN_WIDTH = 28
const MAX_COLUMN_WIDTH = 44
const PANEL_HEIGHT_RATIO = 0.3
const MIN_PANEL_HEIGHT = 8
const MAX_PANEL_HEIGHT = 16
const PANEL_TOP_PADDING = 1
const FOOTER_HEIGHT = 1
const FOOTER_MARGIN = 1
const UNKNOWN = "Unknown"

type Layout = "dock" | "overlay"

type Color = RGBA | string

type Skin = {
  panel: Color
  text: Color
  muted: Color
  subtle: Color
  key: Color
  accent: Color
  tab: Color
  tabText: Color
}

type Entry = {
  type: "entry"
  key: string
  label: string
  group: string
  continues: boolean
}

type Group = {
  label: string
  entries: Entry[]
}

type HeaderItem = { type: "tab"; group: Group } | { type: "scroll" }

type GroupHeader = {
  type: "group"
  label: string
}

type Item = Entry | GroupHeader

function text(value: unknown) {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function ink(api: TuiPluginApi, name: string, fallback: string): Color {
  const value = Reflect.get(api.theme.current, name)
  if (typeof value === "string") return value
  if (value instanceof RGBA) return value
  return fallback
}

function skin(api: TuiPluginApi): Skin {
  return {
    panel: ink(api, "backgroundMenu", "#1c1c1c"),
    text: ink(api, "text", "#f0f0f0"),
    muted: ink(api, "textMuted", "#a5a5a5"),
    subtle: ink(api, "borderSubtle", "#6f6f6f"),
    key: ink(api, "warning", "#ffd75f"),
    accent: ink(api, "primary", "#5f87ff"),
    tab: ink(api, "primary", "#5f87ff"),
    tabText: ink(api, "selectedListItemText", "#ffffff"),
  }
}

function activeKeyLabel(active: ActiveKey<Renderable, KeyEvent>) {
  const group = text(active.bindingAttrs?.group)
  if (active.continues) return group ?? text(active.tokenName) ?? UNKNOWN
  return (
    text(active.commandAttrs?.title) ?? text(active.bindingAttrs?.desc) ?? text(active.commandAttrs?.desc) ?? UNKNOWN
  )
}

function activeKeyGroup(active: ActiveKey<Renderable, KeyEvent>) {
  if (active.continues) return "System"
  return text(active.commandAttrs?.category) ?? text(active.bindingAttrs?.group) ?? UNKNOWN
}

function activeKeyEntry(api: TuiPluginApi, active: ActiveKey<Renderable, KeyEvent>): Entry {
  const key = api.keys.formatSequence([
    {
      stroke: active.stroke,
      display: active.display,
      tokenName: active.tokenName,
    },
  ])
  const label = activeKeyLabel(active)
  return {
    type: "entry",
    key,
    label: active.continues ? `+${label}` : label,
    group: activeKeyGroup(active),
    continues: active.continues,
  }
}

function grouped(entries: Entry[]): Group[] {
  const map = new Map<string, Entry[]>()
  for (const entry of entries) map.set(entry.group, [...(map.get(entry.group) ?? []), entry])
  return [...map]
    .map(([label, entries]) => ({
      label,
      entries: entries.toSorted(
        (a, b) =>
          Number(b.continues) - Number(a.continues) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key),
      ),
    }))
    .toSorted((a, b) => a.label.localeCompare(b.label))
}

function commandShortcut(api: TuiPluginApi, name: string) {
  return useKeymapSelector((keymap) =>
    api.keys.formatSequence(
      keymap.getCommandBindings({ visibility: "registered", commands: [name] }).get(name)?.[0]?.sequence,
    ),
  )
}

function layout(value: unknown): Layout {
  if (value === "overlay") return "overlay"
  return "dock"
}

function HomeHint(props: { api: TuiPluginApi }) {
  const trigger = commandShortcut(props.api, command.toggle)
  const look = createMemo(() => skin(props.api))

  return (
    <box width="100%" maxWidth={75} alignItems="center" paddingTop={1} flexShrink={0}>
      <text fg={look().muted} wrapMode="none">
        Show keyboard shortcuts with <span style={{ fg: look().subtle }}>{trigger() || command.toggle}</span>
      </text>
    </box>
  )
}

function WhichKeyPanel(props: {
  api: TuiPluginApi
  layout: Layout
  mode: () => Layout
  pendingPreview: () => boolean
  pinned: () => boolean
}) {
  const dimensions = useTerminalDimensions()
  const [offset, setOffset] = createSignal(0)
  const [activeGroup, setActiveGroup] = createSignal<string | undefined>()
  const pending = useKeymapSelector((keymap) => keymap.getPendingSequence())
  const active = useKeymapSelector((keymap) => keymap.getActiveKeys({ includeMetadata: true }))
  const pendingActive = createMemo(() => pending().length > 0 && active().length > 0)
  const pendingAutoVisible = createMemo(() => props.mode() === "overlay" && props.pendingPreview() && pendingActive())
  const visible = createMemo(() => props.pinned() || pendingAutoVisible())
  const pendingMode = createMemo(() => visible() && pendingActive())
  const left = 0
  const width = createMemo(() => Math.max(1, dimensions().width))
  const panelHeight = createMemo(() =>
    Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, Math.floor(dimensions().height * PANEL_HEIGHT_RATIO))),
  )
  const contentWidth = createMemo(() => Math.max(1, width() - 2))
  const columns = createMemo(() =>
    Math.max(1, Math.min(3, Math.floor((contentWidth() + COLUMN_GAP) / (MAX_COLUMN_WIDTH + COLUMN_GAP)) || 1)),
  )
  const entries = createMemo(() => active().map((item) => activeKeyEntry(props.api, item)))
  const groups = createMemo(() => grouped(entries()))
  const tabsVisible = createMemo(() => !pendingMode() && groups().length > 0)
  const headerVisible = createMemo(() => tabsVisible() || pendingMode())
  const footerVisible = createMemo(() => !pendingMode())
  const rows = createMemo(() =>
    Math.max(
      1,
      panelHeight() -
        PANEL_TOP_PADDING -
        (headerVisible() ? 1 : 0) -
        (tabsVisible() ? TAB_CONTENT_GAP : 0) -
        (footerVisible() ? FOOTER_MARGIN + FOOTER_HEIGHT : 0),
    ),
  )
  const pageSize = createMemo(() => rows() * columns())
  const currentGroup = createMemo(() => {
    const group = activeGroup()
    return groups().find((item) => item.label === group) ?? groups()[0]
  })
  const activeEntries = createMemo(() => currentGroup()?.entries ?? [])
  const items = createMemo<Item[]>(() => {
    if (!pendingMode()) return activeEntries()
    return groups().flatMap((group) => [{ type: "group", label: group.label } satisfies GroupHeader, ...group.entries])
  })
  const maxOffset = createMemo(() => Math.max(0, items().length - pageSize()))
  const shown = createMemo(() => {
    const columnsItems: Item[][] = []
    let index = offset()
    for (let column = 0; column < columns() && index < items().length; column++) {
      const list: Item[] = []
      while (list.length < rows() && index < items().length) {
        list.push(items()[index]!)
        index += 1
      }
      columnsItems.push(list)
    }
    return columnsItems
  })
  const rowIndexes = createMemo(() => Array.from({ length: rows() }, (_, index) => index))
  const trigger = commandShortcut(props.api, command.toggle)
  const modeTrigger = commandShortcut(props.api, command.toggleLayout)
  const upActive = createMemo(() => offset() > 0)
  const downActive = createMemo(() => offset() < maxOffset())
  const scrollable = createMemo(() => maxOffset() > 0)
  const headerItems = createMemo<HeaderItem[]>(() => [
    ...(tabsVisible() ? groups().map((group) => ({ type: "tab" as const, group })) : []),
    ...(scrollable() ? [{ type: "scroll" as const }] : []),
  ])
  const tabGap = createMemo(() => {
    const itemCount = headerItems().length
    if (itemCount <= 1) return 0
    const itemWidth = headerItems().reduce(
      (sum, item) => sum + (item.type === "tab" ? item.group.label.length + 2 : 3),
      0,
    )
    return Math.max(
      MIN_TAB_GAP,
      Math.min(TAB_GAP, Math.floor((contentWidth() - itemWidth) / (itemCount - 1))),
    )
  })
  const nextMode = createMemo(() => (props.mode() === "dock" ? "overlay" : "dock"))
  const look = createMemo(() => skin(props.api))
  const columnWidth = createMemo(() =>
    Math.max(1, Math.min(MAX_COLUMN_WIDTH, Math.floor((contentWidth() - (columns() - 1) * COLUMN_GAP) / columns()))),
  )
  const clamp = (value: number) => Math.max(0, Math.min(maxOffset(), value))
  const scroll = (delta: number) => setOffset((value) => clamp(value + delta))
  const moveGroup = (delta: number) => {
    if (pendingMode()) return
    const list = groups()
    if (!list.length) return
    const index = Math.max(
      0,
      list.findIndex((item) => item.label === currentGroup()?.label),
    )
    setActiveGroup(list[(index + delta + list.length) % list.length]!.label)
    setOffset(0)
  }

  useBindings(() => ({
    priority: 1000,
    enabled: visible(),
    commands: [
      {
        name: command.groupPrevious,
        title: "Previous key binding group",
        desc: "Show the previous which-key group",
        category: "System",
        run() {
          moveGroup(-1)
        },
      },
      {
        name: command.groupNext,
        title: "Next key binding group",
        desc: "Show the next which-key group",
        category: "System",
        run() {
          moveGroup(1)
        },
      },
      {
        name: command.scrollUp,
        title: "Scroll key bindings up",
        desc: "Scroll the which-key panel up",
        category: "System",
        run() {
          scroll(-columns())
        },
      },
      {
        name: command.scrollDown,
        title: "Scroll key bindings down",
        desc: "Scroll the which-key panel down",
        category: "System",
        run() {
          scroll(columns())
        },
      },
      {
        name: command.pageUp,
        title: "Page key bindings up",
        desc: "Page the which-key panel up",
        category: "System",
        run() {
          scroll(-pageSize())
        },
      },
      {
        name: command.pageDown,
        title: "Page key bindings down",
        desc: "Page the which-key panel down",
        category: "System",
        run() {
          scroll(pageSize())
        },
      },
      {
        name: command.home,
        title: "First key binding",
        desc: "Jump to the first which-key binding",
        category: "System",
        run() {
          setOffset(0)
        },
      },
      {
        name: command.end,
        title: "Last key binding",
        desc: "Jump to the last which-key binding",
        category: "System",
        run() {
          setOffset(maxOffset())
        },
      },
    ],
    bindings: props.api.tuiConfig.keymap.pick("which_key", pendingMode() ? scrollCommands : panelCommands),
  }))

  createEffect(() => {
    if (pendingMode()) return
    const group = currentGroup()
    if (group?.label === activeGroup()) return
    setActiveGroup(group?.label)
  })

  createEffect(() => {
    if (pendingMode()) return
    activeGroup()
    setOffset(0)
  })

  createEffect(() => {
    if (!visible()) setOffset(0)
  })

  createEffect(() => {
    pending()
    setOffset(0)
  })

  createEffect(() => {
    setOffset((value) => clamp(value))
  })

  return (
    <Show when={visible()}>
      <box
        position={props.layout === "overlay" ? "absolute" : "relative"}
        zIndex={3500}
        left={left}
        bottom={props.layout === "overlay" ? 0 : undefined}
        width={dimensions().width}
        height={panelHeight()}
        backgroundColor={look().panel}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        flexShrink={0}
        flexDirection="column"
      >
        <Show when={headerVisible()}>
          <box width="100%" flexDirection="row" justifyContent="center" gap={tabGap()} flexShrink={0}>
            <For each={headerItems()}>
              {(item) => (
                <Show
                  when={item.type === "tab" ? item.group : undefined}
                  fallback={
                    <box flexShrink={0}>
                      <text wrapMode="none">
                        <span style={{ fg: upActive() ? look().text : look().muted }}>↑</span>
                        <span style={{ fg: look().muted }}> </span>
                        <span style={{ fg: downActive() ? look().text : look().muted }}>↓</span>
                      </text>
                    </box>
                  }
                >
                  {(group) => {
                    const selected = createMemo(() => currentGroup()?.label === group().label)
                    return (
                      <box
                        paddingLeft={1}
                        paddingRight={1}
                        flexShrink={0}
                        backgroundColor={selected() ? look().tab : undefined}
                        onMouseDown={() => {
                          setActiveGroup(group().label)
                          setOffset(0)
                        }}
                      >
                        <text
                          fg={selected() ? look().tabText : look().muted}
                          attributes={selected() ? TextAttributes.BOLD : undefined}
                          wrapMode="none"
                        >
                          {group().label}
                        </text>
                      </box>
                    )
                  }}
                </Show>
              )}
            </For>
          </box>
        </Show>
        <Show when={tabsVisible()}>
          <box height={TAB_CONTENT_GAP} flexShrink={0} />
        </Show>
        <box height={rows()} flexShrink={0} flexDirection="column">
          <Show when={shown().length > 0} fallback={<text fg={look().muted}>No reachable bindings</text>}>
            <For each={rowIndexes()}>
              {(row) => (
                <box width="100%" flexDirection="row" justifyContent="center" gap={COLUMN_GAP}>
                  <For each={shown()}>
                    {(column) => {
                      const item = createMemo(() => column[row])
                      const entry = createMemo(() => {
                        const value = item()
                        if (value?.type !== "entry") return undefined
                        return value
                      })
                      return (
                        <box width={columnWidth()} flexDirection="row" gap={1} justifyContent="space-between">
                          <Show when={item()}>
                            {(value) => (
                              <Show
                                when={entry()}
                                fallback={
                                  <text fg={look().accent} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                                    {value().label}
                                  </text>
                                }
                              >
                                {(binding) => (
                                  <>
                                    <box flexGrow={1} minWidth={0}>
                                      <text
                                        fg={binding().continues ? look().accent : look().muted}
                                        wrapMode="none"
                                        truncate
                                      >
                                        {binding().label}
                                      </text>
                                    </box>
                                    <box flexShrink={0}>
                                      <text fg={look().text} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                                        {binding().key}
                                      </text>
                                    </box>
                                  </>
                                )}
                              </Show>
                            )}
                          </Show>
                        </box>
                      )
                    }}
                  </For>
                </box>
              )}
            </For>
          </Show>
        </box>
        <Show when={footerVisible()}>
          <box height={FOOTER_MARGIN} flexShrink={0} />
          <box width="100%" flexDirection="row" justifyContent="space-between" flexShrink={0}>
            <box>
              <text fg={look().text} wrapMode="none">
                toggle <span style={{ fg: look().subtle }}>{trigger() || command.toggle}</span>
              </text>
            </box>
            <box>
              <text fg={look().text} wrapMode="none">
                {nextMode()} <span style={{ fg: look().subtle }}>{modeTrigger() || command.toggleLayout}</span>
              </text>
            </box>
          </box>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  const [pinned, setPinned] = createSignal(false)
  const [mode, setMode] = createSignal(layout(api.kv.get(KV_LAYOUT, "dock")))
  const [pendingPreview, setPendingPreview] = createSignal(api.kv.get(KV_PENDING_PREVIEW, false))

  api.keymap.registerLayer({
    priority: LAYER_PRIORITY,
    commands: [
      {
        name: command.toggle,
        title: "Show key bindings",
        desc: "Toggle which-key overlay",
        category: "System",
        run() {
          setPinned((value) => !value)
        },
      },
      {
        name: command.toggleLayout,
        title: "Toggle key bindings layout",
        desc: "Switch which-key between dock and overlay mode",
        category: "System",
        run() {
          setMode((value) => {
            const next = value === "dock" ? "overlay" : "dock"
            api.kv.set(KV_LAYOUT, next)
            return next
          })
        },
      },
      {
        name: command.togglePending,
        title: "Toggle pending key preview",
        desc: "Automatically show which-key for pending key sequences in overlay mode",
        category: "System",
        run() {
          setPendingPreview((value) => {
            api.kv.set(KV_PENDING_PREVIEW, !value)
            return !value
          })
        },
      },
    ],
    bindings: api.tuiConfig.keymap.pick("which_key", toggleCommands),
  })

  api.slots.register({
    order: 200,
    slots: {
      home_bottom() {
        return <HomeHint api={api} />
      },
      app() {
        return (
          <Show when={mode() === "overlay"}>
            <WhichKeyPanel api={api} layout="overlay" mode={mode} pendingPreview={pendingPreview} pinned={pinned} />
          </Show>
        )
      },
      app_bottom() {
        return (
          <Show when={mode() === "dock"}>
            <WhichKeyPanel api={api} layout="dock" mode={mode} pendingPreview={pendingPreview} pinned={pinned} />
          </Show>
        )
      },
    },
  })
}

const plugin: InternalTuiPlugin = {
  id: "tui-which-key",
  enabled: false,
  tui,
}

export default plugin
