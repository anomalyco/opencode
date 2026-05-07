/** @jsxImportSource @opentui/solid */
import { RGBA, TextAttributes, type KeyEvent, type Renderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { useKeymapSelector } from "@opentui/keymap/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { ActiveKey } from "@opentui/keymap"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"

const command = {
  toggle: "tui-which-key.toggle",
  toggleLayout: "tui-which-key.layout.toggle",
} as const

const DEFAULT_KEY = "ctrl+alt+k"
const DEFAULT_LAYOUT_KEY = "ctrl+alt+shift+k"
const LAYER_PRIORITY = 900

type Layout = "dock" | "overlay"

type WhichKeyOptions = {
  key?: unknown
}

type Color = RGBA | string

type Skin = {
  panel: Color
  text: Color
  muted: Color
  key: Color
  accent: Color
}

type Entry = {
  type: "entry"
  key: string
  label: string
  group: string
  continues: boolean
}

type GroupHeader = {
  type: "group"
  label: string
}

type Item = Entry | GroupHeader

function pickKey(options: WhichKeyOptions | undefined) {
  if (typeof options?.key !== "string") return DEFAULT_KEY
  const key = options.key.trim()
  if (!key || key === "none") return DEFAULT_KEY
  return key
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
  }
}

function activeKeyLabel(active: ActiveKey<Renderable, KeyEvent>) {
  const group = text(active.bindingAttrs?.group)
  if (active.continues && group) return group
  return (
    text(active.bindingAttrs?.desc) ??
    text(active.commandAttrs?.desc) ??
    text(active.commandAttrs?.title) ??
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

function grouped(entries: Entry[]): Item[] {
  const map = new Map<string, Entry[]>()
  for (const entry of entries) map.set(entry.group, [...(map.get(entry.group) ?? []), entry])
  return [...map].flatMap(([label, items]) => [{ type: "group", label } satisfies GroupHeader, ...items])
}

function previousGroup(items: readonly Item[], index: number) {
  const item = items[index - 1]
  if (!item) return undefined
  if (item.type === "group") return item.label
  return item.group
}

function WhichKeyPanel(props: {
  api: TuiPluginApi
  layout: Layout
  mode: () => Layout
  pinned: () => boolean
  trigger: string
  modeTrigger: string
}) {
  const dimensions = useTerminalDimensions()
  const [offset, setOffset] = createSignal(0)
  const pending = useKeymapSelector((keymap) => keymap.getPendingSequence())
  const active = useKeymapSelector((keymap) => keymap.getActiveKeys({ includeMetadata: true }))
  const visible = createMemo(() => props.pinned() || (pending().length > 0 && active().length > 0))
  const left = 0
  const width = createMemo(() => Math.max(1, dimensions().width))
  const columns = createMemo(() => Math.max(1, Math.min(6, Math.floor((width() - 2) / 42) || 1)))
  const rows = createMemo(() => Math.max(3, Math.min(18, dimensions().height - 8)))
  const pageSize = createMemo(() => rows() * columns())
  const entries = createMemo(() => active().map((item) => activeKeyEntry(props.api, item)))
  const items = createMemo(() => grouped(entries()))
  const maxOffset = createMemo(() => Math.max(0, items().length - pageSize()))
  const shown = createMemo(() => {
    const columnsItems: Item[][] = []
    const targetRows = Math.max(
      1,
      Math.min(rows(), Math.ceil(Math.min(pageSize(), items().length - offset()) / columns())),
    )
    let index = offset()
    for (let column = 0; column < columns() && index < items().length; column++) {
      const list: Item[] = []
      const current = items()[index]
      const repeatGroup =
        current?.type === "entry" && previousGroup(items(), index) === current.group && targetRows < rows()
      if (repeatGroup) {
        list.push({ type: "group", label: current.group })
      }
      while (list.length < targetRows + (repeatGroup ? 1 : 0) && index < items().length) {
        const item = items()[index]!
        if (item.type === "group" && list.length > 0 && list.length + 1 >= targetRows && index + 1 < items().length) {
          break
        }
        list.push(item)
        index += 1
      }
      columnsItems.push(list)
    }
    return columnsItems
  })
  const visibleRows = createMemo(() => Math.max(1, ...shown().map((column) => column.length)))
  const rowIndexes = createMemo(() => Array.from({ length: visibleRows() }, (_, index) => index))
  const columnIndexes = createMemo(() => Array.from({ length: columns() }, (_, index) => index))
  const position = createMemo(() => {
    if (!entries().length) return "0 bindings"
    return `page ${Math.floor(offset() / pageSize()) + 1}/${Math.max(1, Math.ceil(items().length / pageSize()))}  ${entries().length} bindings`
  })
  const prefix = createMemo(() => props.api.keys.formatSequence(pending()))
  const trigger = createMemo(() => props.api.keys.formatSequence(props.api.keymap.parseKeySequence(props.trigger)))
  const modeTrigger = createMemo(() => props.api.keys.formatSequence(props.api.keymap.parseKeySequence(props.modeTrigger)))
  const look = createMemo(() => skin(props.api))
  const top = createMemo(() => Math.max(0, dimensions().height - visibleRows() - 3))
  const columnWidth = createMemo(() => Math.max(24, Math.floor((width() - 2 - (columns() - 1) * 2) / columns())))
  const keyWidth = createMemo(() => Math.min(18, Math.max(4, ...entries().map((entry) => entry.key.length))))
  const matchers = {
    up: ["ctrl+alt+up", "ctrl+alt+p"].map((key) => props.api.keymap.createKeyMatcher(key)),
    down: ["ctrl+alt+down", "ctrl+alt+n"].map((key) => props.api.keymap.createKeyMatcher(key)),
    pageUp: ["ctrl+alt+pageup"].map((key) => props.api.keymap.createKeyMatcher(key)),
    pageDown: ["ctrl+alt+pagedown"].map((key) => props.api.keymap.createKeyMatcher(key)),
    home: ["ctrl+alt+home"].map((key) => props.api.keymap.createKeyMatcher(key)),
    end: ["ctrl+alt+end"].map((key) => props.api.keymap.createKeyMatcher(key)),
  }

  const clamp = (value: number) => Math.max(0, Math.min(maxOffset(), value))
  const scroll = (delta: number) => setOffset((value) => clamp(value + delta))
  const matches = (items: readonly ((input: KeyEvent) => boolean)[], event: KeyEvent) =>
    items.some((match) => match(event))

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

  onCleanup(
    props.api.keymap.intercept(
      "key",
      ({ event, consume }) => {
        if (!visible()) return
        if (matches(matchers.up, event)) scroll(-columns())
        else if (matches(matchers.down, event)) scroll(columns())
        else if (matches(matchers.pageUp, event)) scroll(-pageSize())
        else if (matches(matchers.pageDown, event)) scroll(pageSize())
        else if (matches(matchers.home, event)) setOffset(0)
        else if (matches(matchers.end, event)) setOffset(maxOffset())
        else return
        consume()
      },
      { priority: 1000 },
    ),
  )

  return (
    <Show when={visible()}>
      <box
        position={props.layout === "overlay" ? "absolute" : "relative"}
        zIndex={3500}
        left={left}
        top={props.layout === "overlay" ? top() : undefined}
        width={dimensions().width}
        backgroundColor={look().panel}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        flexShrink={0}
        flexDirection="column"
      >
        <Show when={shown().length > 0} fallback={<text fg={look().muted}>No reachable bindings</text>}>
          <For each={rowIndexes()}>
            {(row) => (
              <box flexDirection="row" gap={2}>
                <For each={columnIndexes()}>
                  {(column) => {
                    const item = createMemo(() => shown()[column]?.[row])
                    const binding = createMemo(() => {
                      const value = item()
                      if (value?.type !== "entry") return undefined
                      return value
                    })
                    return (
                      <box width={columnWidth()} flexDirection="row" gap={1}>
                        <Show when={item()}>
                          {(entry) => (
                            <Show
                              when={binding()}
                              fallback={
                                <text fg={look().accent} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                                  {`+${entry().label}`}
                                </text>
                              }
                            >
                              {(binding) => (
                                <>
                                  <box width={keyWidth()}>
                                    <text fg={look().key} attributes={TextAttributes.BOLD} wrapMode="none" truncate>
                                      {binding().key}
                                    </text>
                                  </box>
                                  <text fg={look().muted} wrapMode="none">
                                    {"->"}
                                  </text>
                                  <box flexGrow={1}>
                                    <text
                                      fg={binding().continues ? look().accent : look().text}
                                      wrapMode="none"
                                      truncate
                                    >
                                      {binding().label}
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
        <box flexDirection="row" justifyContent="space-between" paddingTop={1}>
          <text fg={look().muted} wrapMode="none">
            {props.pinned() ? `toggle ${trigger()}` : prefix() ? `pending ${prefix()}` : trigger()}
          </text>
          <text fg={look().muted} wrapMode="none">
            {`${position()}  ${props.mode()} ${modeTrigger()}  scroll ctrl+alt+up/down`}
          </text>
        </box>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api, options) => {
  const trigger = pickKey(options as WhichKeyOptions | undefined)
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
    bindings: [
      { key: trigger, cmd: command.toggle, desc: "Show key bindings", group: "Global" },
      { key: DEFAULT_LAYOUT_KEY, cmd: command.toggleLayout, desc: "Toggle key bindings layout", group: "Global" },
    ],
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
              trigger={trigger}
              modeTrigger={DEFAULT_LAYOUT_KEY}
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
              trigger={trigger}
              modeTrigger={DEFAULT_LAYOUT_KEY}
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
