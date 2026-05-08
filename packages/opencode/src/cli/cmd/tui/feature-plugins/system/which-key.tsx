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
const toggleCommands = [command.toggle, command.toggleLayout] as const
const panelCommands = [
  command.groupPrevious,
  command.groupNext,
  command.scrollUp,
  command.scrollDown,
  command.pageUp,
  command.pageDown,
  command.home,
  command.end,
] as const
const COLUMN_GAP = 4
const MIN_COLUMN_WIDTH = 28
const MAX_COLUMN_WIDTH = 44
const PANEL_HEIGHT_RATIO = 0.3

type Layout = "dock" | "overlay"

type Color = RGBA | string

type Skin = {
  panel: Color
  text: Color
  muted: Color
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
    key: ink(api, "warning", "#ffd75f"),
    accent: ink(api, "primary", "#5f87ff"),
    tab: ink(api, "backgroundElement", "#303030"),
    tabText: ink(api, "text", "#f0f0f0"),
  }
}

function activeKeyLabel(active: ActiveKey<Renderable, KeyEvent>) {
  const group = text(active.bindingAttrs?.group)
  if (active.continues && group) return group
  return (
    text(active.commandAttrs?.title) ??
    text(active.bindingAttrs?.desc) ??
    text(active.commandAttrs?.desc) ??
    (typeof active.command === "string" ? active.command : undefined) ??
    (active.continues ? "prefix" : "binding")
  )
}

function activeKeyGroup(active: ActiveKey<Renderable, KeyEvent>) {
  return text(active.commandAttrs?.category) ?? text(active.bindingAttrs?.group) ?? "Other"
}

function activeKeyEntry(api: TuiPluginApi, active: ActiveKey<Renderable, KeyEvent>): Entry {
  const label = activeKeyLabel(active)
  return {
    type: "entry",
    key: api.keys.formatSequence([
      {
        stroke: active.stroke,
        display: active.display,
        tokenName: active.tokenName,
      },
    ]),
    label: active.continues ? `+${label}` : label,
    group: activeKeyGroup(active),
    continues: active.continues,
  }
}

function grouped(entries: Entry[]): Group[] {
  const map = new Map<string, Entry[]>()
  for (const entry of entries) map.set(entry.group, [...(map.get(entry.group) ?? []), entry])
  return [...map].map(([label, entries]) => ({ label, entries }))
}

function commandShortcut(api: TuiPluginApi, name: string) {
  return useKeymapSelector((keymap) =>
    api.keys.formatSequence(
      keymap.getCommandBindings({ visibility: "registered", commands: [name] }).get(name)?.[0]?.sequence,
    ),
  )
}

function WhichKeyPanel(props: {
  api: TuiPluginApi
  layout: Layout
  mode: () => Layout
  pinned: () => boolean
}) {
  const dimensions = useTerminalDimensions()
  const [offset, setOffset] = createSignal(0)
  const [activeGroup, setActiveGroup] = createSignal<string | undefined>()
  const pending = useKeymapSelector((keymap) => keymap.getPendingSequence())
  const active = useKeymapSelector((keymap) => keymap.getActiveKeys({ includeMetadata: true }))
  const visible = createMemo(() => props.pinned() || (pending().length > 0 && active().length > 0))
  const left = 0
  const width = createMemo(() => Math.max(1, dimensions().width))
  const panelHeight = createMemo(() => Math.max(6, Math.floor(dimensions().height * PANEL_HEIGHT_RATIO)))
  const columns = createMemo(() =>
    Math.max(1, Math.min(3, Math.floor((width() - 2 + COLUMN_GAP) / (MIN_COLUMN_WIDTH + COLUMN_GAP)) || 1)),
  )
  const rows = createMemo(() => Math.max(1, panelHeight() - 3))
  const pageSize = createMemo(() => rows() * columns())
  const entries = createMemo(() => active().map((item) => activeKeyEntry(props.api, item)))
  const groups = createMemo(() => grouped(entries()))
  const currentGroup = createMemo(() => {
    const group = activeGroup()
    return groups().find((item) => item.label === group) ?? groups()[0]
  })
  const activeEntries = createMemo(() => currentGroup()?.entries ?? [])
  const maxOffset = createMemo(() => Math.max(0, activeEntries().length - pageSize()))
  const shown = createMemo(() => {
    const columnsItems: Entry[][] = []
    let index = offset()
    for (let column = 0; column < columns() && index < activeEntries().length; column++) {
      const list: Entry[] = []
      while (list.length < rows() && index < activeEntries().length) {
        list.push(activeEntries()[index]!)
        index += 1
      }
      columnsItems.push(list)
    }
    return columnsItems
  })
  const rowIndexes = createMemo(() => Array.from({ length: rows() }, (_, index) => index))
  const columnIndexes = createMemo(() => Array.from({ length: columns() }, (_, index) => index))
  const position = createMemo(() => {
    if (!activeEntries().length) return "0 bindings"
    return `page ${Math.floor(offset() / pageSize()) + 1}/${Math.max(1, Math.ceil(activeEntries().length / pageSize()))}  ${activeEntries().length} bindings`
  })
  const prefix = createMemo(() => props.api.keys.formatSequence(pending()))
  const trigger = commandShortcut(props.api, command.toggle)
  const modeTrigger = commandShortcut(props.api, command.toggleLayout)
  const scrollUpTrigger = commandShortcut(props.api, command.scrollUp)
  const scrollDownTrigger = commandShortcut(props.api, command.scrollDown)
  const look = createMemo(() => skin(props.api))
  const columnWidth = createMemo(() =>
    Math.max(1, Math.min(MAX_COLUMN_WIDTH, Math.floor((width() - 2 - (columns() - 1) * COLUMN_GAP) / columns()))),
  )
  const clamp = (value: number) => Math.max(0, Math.min(maxOffset(), value))
  const scroll = (delta: number) => setOffset((value) => clamp(value + delta))
  const moveGroup = (delta: number) => {
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
    bindings: props.api.tuiConfig.keymap.pick("which_key", panelCommands),
  }))

  createEffect(() => {
    const group = currentGroup()
    if (group?.label === activeGroup()) return
    setActiveGroup(group?.label)
  })

  createEffect(() => {
    activeGroup()
    setOffset(0)
  })

  createEffect(() => {
    if (!visible()) setOffset(0)
  })

  createEffect(() => {
    prefix()
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
        <Show when={groups().length > 0}>
          <box flexDirection="row" justifyContent="center" gap={1} paddingRight={1}>
            <For each={groups()}>
              {(group) => {
                const selected = createMemo(() => currentGroup()?.label === group.label)
                return (
                  <text
                    fg={selected() ? look().tabText : look().muted}
                    wrapMode="none"
                    truncate
                    onMouseDown={() => {
                      setActiveGroup(group.label)
                      setOffset(0)
                    }}
                  >
                    <span
                      style={{
                        fg: selected() ? look().tabText : look().muted,
                        bg: selected() ? look().tab : undefined,
                        bold: selected(),
                      }}
                    >
                      {selected() ? ` ${group.label} ` : group.label}
                    </span>
                  </text>
                )
              }}
            </For>
          </box>
        </Show>
        <box height={rows()} flexShrink={0} flexDirection="column">
          <Show when={shown().length > 0} fallback={<text fg={look().muted}>No reachable bindings</text>}>
            <For each={rowIndexes()}>
              {(row) => (
                <box flexDirection="row" gap={COLUMN_GAP}>
                  <For each={columnIndexes()}>
                    {(column) => {
                      const entry = createMemo(() => shown()[column]?.[row])
                      return (
                        <box width={columnWidth()} flexDirection="row" gap={1} justifyContent="space-between">
                          <Show when={entry()}>
                            {(binding) => (
                              <>
                                <box flexGrow={1} minWidth={0}>
                                  <text fg={binding().continues ? look().accent : look().text} wrapMode="none" truncate>
                                    {binding().label}
                                  </text>
                                </box>
                                <box flexShrink={0}>
                                  <text fg={look().key} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                                    {binding().key}
                                  </text>
                                </box>
                              </>
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
        <box flexDirection="row" justifyContent="space-between" paddingTop={1}>
          <text fg={look().muted} wrapMode="none">
            {props.pinned() ? `toggle ${trigger() || command.toggle}` : prefix() ? `pending ${prefix()}` : trigger()}
          </text>
          <text fg={look().muted} wrapMode="none">
            {`${position()}  ${props.mode()} ${modeTrigger() || command.toggleLayout}  scroll ${
              scrollUpTrigger() || command.scrollUp
            }/${scrollDownTrigger() || command.scrollDown}`}
          </text>
        </box>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  const [pinned, setPinned] = createSignal(false)
  const [layout, setLayout] = createSignal<Layout>("dock")

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
          setLayout((value) => (value === "dock" ? "overlay" : "dock"))
        },
      },
    ],
    bindings: api.tuiConfig.keymap.pick("which_key", toggleCommands),
  })

  api.slots.register({
    slots: {
      app() {
        return (
          <Show when={layout() === "overlay"}>
            <WhichKeyPanel
              api={api}
              layout="overlay"
              mode={layout}
              pinned={pinned}
            />
          </Show>
        )
      },
      app_bottom() {
        return (
          <Show when={layout() === "dock"}>
            <WhichKeyPanel
              api={api}
              layout="dock"
              mode={layout}
              pinned={pinned}
            />
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
