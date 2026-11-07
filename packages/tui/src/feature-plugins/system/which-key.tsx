/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js"
import { Keymap } from "../../context/keymap"
import { useTheme } from "../../context/theme"
import { DIALOG_INSET, DialogHeader, DialogLayout, dialogWidth, useDialog } from "../../ui/dialog"
import { Locale } from "../../util/locale"
import { stringWidth } from "../../util/string-width"

const commands = {
  toggle: "which-key.toggle",
  layout: "which-key.layout.toggle",
  pending: "which-key.pending.toggle",
  previousGroup: "which-key.group.previous",
  nextGroup: "which-key.group.next",
  scrollUp: "which-key.scroll.up",
  scrollDown: "which-key.scroll.down",
  pageUp: "which-key.page.up",
  pageDown: "which-key.page.down",
  home: "which-key.home",
  end: "which-key.end",
} as const

const globalCommands = [commands.toggle, commands.layout, commands.pending] as const
const scrollCommands = [
  commands.scrollUp,
  commands.scrollDown,
  commands.pageUp,
  commands.pageDown,
  commands.home,
  commands.end,
] as const
const panelCommands = [commands.previousGroup, commands.nextGroup, ...scrollCommands] as const
const PANEL_GROUP = "Which-key"
const MIN_COLUMN_WIDTH = 34
const MAX_COLUMNS = 4
const COLUMN_GAP = 2
const DOCK_CHROME = 6
const PREVIEW_CHROME = 4
const POPUP_SIZE = "large" as const
const POPUP_DIALOG_KEY = Symbol("which-key")
const POPUP_HORIZONTAL_CHROME = DIALOG_INSET * 2

type Layout = "popup" | "dock"
type Surface = "none" | "popup" | "dock" | "preview"
type ActiveKey = ReturnType<ReturnType<typeof Keymap.useState>["active"]>[number]

type Entry = {
  key: string
  label: string
  group: string
  continues: boolean
}

type Row =
  { kind: "gap" } | { kind: "header"; label: string; count: number } | { kind: "entries"; cells: (Entry | undefined)[] }

function toEntries(active: readonly ActiveKey[]) {
  return active
    .filter((item) => item.group !== PANEL_GROUP)
    .map((item) => ({
      key: item.key,
      label: item.title ?? item.description ?? (item.continues ? "More shortcuts" : "Unknown command"),
      group: item.group ?? (item.continues ? "Sequences" : "Other"),
      continues: item.continues,
    }))
}

function toGroups(entries: readonly Entry[]) {
  const grouped = entries.reduce((result, entry) => {
    result.set(entry.group, [...(result.get(entry.group) ?? []), entry])
    return result
  }, new Map<string, Entry[]>())
  return [...grouped]
    .map(([label, items]) => ({
      label,
      entries: items.toSorted(
        (a, b) =>
          Number(b.continues) - Number(a.continues) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key),
      ),
    }))
    .toSorted((a, b) => a.label.localeCompare(b.label))
}

function createState(context: Plugin.Context) {
  const dimensions = useTerminalDimensions()
  const keymap = Keymap.useState()
  const [pinned, setPinned] = createSignal(false)
  const [layout, setLayout] = createSignal<Layout>("popup")
  const [pendingPreview, setPendingPreview] = createSignal(false)
  const [offset, setOffset] = createSignal(0)
  const [snapshot, setSnapshot] = createSignal<Entry[] | null>(null)
  const pendingActive = createMemo(() => keymap.pending().length > 0 && keymap.active().length > 0)
  const surface = createMemo<Surface>(() => {
    if (pinned()) return layout() === "popup" ? "popup" : "dock"
    if (pendingPreview() && pendingActive()) return "preview"
    return "none"
  })
  const visible = createMemo(() => surface() !== "none")
  const previewMode = createMemo(() => surface() === "preview")
  const liveEntries = createMemo(() => toEntries(keymap.active()))
  // A modal dialog changes which bindings are reachable, so the floating panel keeps the
  // bindings it captured in the route it was opened from.
  const entries = createMemo(() => (surface() === "popup" ? (snapshot() ?? liveEntries()) : liveEntries()))
  const groups = createMemo(() => toGroups(entries()))
  const popupWidth = createMemo(() =>
    Math.max(8, Math.min(dialogWidth(POPUP_SIZE), dimensions().width - 2) - POPUP_HORIZONTAL_CHROME),
  )
  const contentWidth = createMemo(() => (surface() === "popup" ? popupWidth() : Math.max(1, dimensions().width - 2)))
  const columns = createMemo(() =>
    Math.max(1, Math.min(MAX_COLUMNS, Math.floor((contentWidth() + COLUMN_GAP) / (MIN_COLUMN_WIDTH + COLUMN_GAP)))),
  )
  const columnWidth = createMemo(() =>
    Math.max(1, Math.floor((contentWidth() - (columns() - 1) * COLUMN_GAP) / columns())),
  )
  const rows = createMemo<Row[]>(() => {
    const result: Row[] = []
    for (const group of groups()) {
      if (result.length > 0) result.push({ kind: "gap" })
      result.push({ kind: "header", label: group.label, count: group.entries.length })
      for (let index = 0; index < group.entries.length; index += columns()) {
        result.push({ kind: "entries", cells: group.entries.slice(index, index + columns()) })
      }
    }
    return result
  })
  const contentRows = createMemo(() => {
    const popup = surface() === "popup"
    const ceiling = Math.max(4, dimensions().height - (popup ? 7 : 8))
    const limit = popup
      ? Math.max(3, Math.min(Math.floor(dimensions().height * 0.55), ceiling))
      : Math.max(1, Math.floor(dimensions().height * 0.45) - (previewMode() ? PREVIEW_CHROME : DOCK_CHROME))
    // Grow past a section heading instead of painting a label with no keys under it.
    let count = Math.max(1, Math.min(rows().length, limit))
    while (count < rows().length && count < ceiling) {
      const last = rows()[count - 1]
      if (last?.kind !== "header" && last?.kind !== "gap") break
      count += 1
    }
    return count
  })
  const pageSize = createMemo(() => contentRows())
  const maxOffset = createMemo(() => Math.max(0, rows().length - contentRows()))
  const shown = createMemo(() => rows().slice(offset(), offset() + contentRows()))
  const scrollable = createMemo(() => maxOffset() > 0)
  const activeSection = createMemo(() => {
    const list = rows()
    for (let index = Math.min(offset(), list.length - 1); index >= 0; index--) {
      const row = list[index]
      if (row?.kind === "header") return row.label
    }
    return groups()[0]?.label
  })
  const activeSectionIndex = createMemo(() =>
    Math.max(
      0,
      groups().findIndex((group) => group.label === activeSection()),
    ),
  )
  const panelHeight = createMemo(() => contentRows() + (previewMode() ? PREVIEW_CHROME : DOCK_CHROME))
  const shortcut = (id: string) => context.keymap.shortcuts(id)[0] ?? ""
  const clamp = (value: number) => Math.max(0, Math.min(maxOffset(), value))
  const scroll = (amount: number) => {
    setOffset((value) => clamp(value + amount))
  }
  const jumpTo = (label: string) => {
    const index = rows().findIndex((row) => row.kind === "header" && row.label === label)
    if (index >= 0) setOffset(clamp(index))
  }
  const moveGroup = (amount: number) => {
    const list = groups()
    if (!list.length) return
    const index = (activeSectionIndex() + amount + list.length) % list.length
    jumpTo(list[index]?.label ?? "")
  }

  context.keymap.layer(() => ({
    mode: "global",
    priority: 900,
    commands: [
      {
        id: commands.toggle,
        bind: false,
        title: pinned() ? "Hide keyboard shortcuts" : "Show keyboard shortcuts",
        description: "Toggle the which-key panel",
        group: "System",
        palette: true,
        run() {
          setPinned((value) => !value)
        },
      },
      {
        id: commands.layout,
        bind: false,
        title: layout() === "popup" ? "Dock keyboard shortcuts" : "Float keyboard shortcuts",
        description: "Switch which-key between the shortcut popup and the docked panel",
        group: "System",
        palette: true,
        run() {
          setLayout((value) => (value === "popup" ? "dock" : "popup"))
        },
      },
      {
        id: commands.pending,
        bind: false,
        title: `${pendingPreview() ? "Disable" : "Enable"} pending shortcut preview`,
        description: "Automatically show valid keys after a shortcut prefix",
        group: "System",
        palette: true,
        run() {
          setPendingPreview((value) => !value)
        },
      },
    ],
    bindings: globalCommands,
  }))

  context.keymap.layer(() => ({
    mode: "global",
    priority: 1000,
    enabled: visible(),
    commands: [
      {
        id: commands.previousGroup,
        bind: false,
        title: "Previous shortcut group",
        group: PANEL_GROUP,
        run: () => moveGroup(-1),
      },
      {
        id: commands.nextGroup,
        bind: false,
        title: "Next shortcut group",
        group: PANEL_GROUP,
        run: () => moveGroup(1),
      },
      {
        id: commands.scrollUp,
        bind: false,
        title: "Scroll shortcuts up",
        group: PANEL_GROUP,
        run() {
          scroll(-1)
        },
      },
      {
        id: commands.scrollDown,
        bind: false,
        title: "Scroll shortcuts down",
        group: PANEL_GROUP,
        run() {
          scroll(1)
        },
      },
      {
        id: commands.pageUp,
        bind: false,
        title: "Page shortcuts up",
        group: PANEL_GROUP,
        run() {
          scroll(-pageSize())
        },
      },
      {
        id: commands.pageDown,
        bind: false,
        title: "Page shortcuts down",
        group: PANEL_GROUP,
        run() {
          scroll(pageSize())
        },
      },
      {
        id: commands.home,
        bind: false,
        title: "First shortcut",
        group: PANEL_GROUP,
        run() {
          setOffset(0)
        },
      },
      {
        id: commands.end,
        bind: false,
        title: "Last shortcut",
        group: PANEL_GROUP,
        run() {
          setOffset(maxOffset())
        },
      },
    ],
    bindings: previewMode() ? scrollCommands : panelCommands,
  }))

  createEffect(() => {
    keymap.pending()
    setOffset(0)
  })
  createEffect(() => {
    setOffset((value) => clamp(value))
  })
  createEffect(() => {
    if (!visible()) setOffset(0)
  })

  return {
    context,
    keymap,
    pinned,
    setPinned,
    layout,
    pendingPreview,
    surface,
    liveEntries,
    setSnapshot,
    entries,
    groups,
    contentWidth,
    columns,
    columnWidth,
    contentRows,
    shown,
    scrollable,
    activeSection,
    activeSectionIndex,
    panelHeight,
    shortcut,
    scroll,
    jumpTo,
    moveGroup,
  }
}

type State = ReturnType<typeof createState>
type Theme = Plugin.Context["theme"]

function Body(props: { state: State; mode: Surface; theme: Theme }) {
  const state = props.state
  const theme = props.theme
  return (
    <box width="100%" flexDirection="column">
      <Show when={props.mode !== "preview"}>
        <Tabs state={state} theme={props.theme} />
        <box height={1} flexShrink={0} />
      </Show>
      <box height={state.contentRows()} width="100%" flexShrink={0} flexDirection="column">
        <Show when={state.entries().length > 0} fallback={<text fg={theme.text.muted}>No reachable bindings</text>}>
          <For each={state.shown()}>
            {(row) => {
              if (row.kind === "gap") return <box height={1} width="100%" flexShrink={0} />
              if (row.kind === "header")
                return (
                  <box height={1} width="100%" flexShrink={0} flexDirection="row" gap={1} paddingLeft={1}>
                    <text fg={theme.text.action.primary.base} attributes={TextAttributes.BOLD} wrapMode="none">
                      {row.label}
                    </text>
                    <text fg={theme.text.muted} wrapMode="none">
                      {row.count}
                    </text>
                  </box>
                )
              return (
                <box height={1} width="100%" flexShrink={0} flexDirection="row" gap={COLUMN_GAP}>
                  <For each={Array.from({ length: state.columns() }, (_, index) => index)}>
                    {(column) => (
                      <Show
                        when={row.cells[column]}
                        fallback={<box height={1} width={state.columnWidth()} flexShrink={0} />}
                      >
                        {(entry) => (
                          <box
                            height={1}
                            width={state.columnWidth()}
                            minWidth={0}
                            flexShrink={0}
                            paddingLeft={1}
                            paddingRight={1}
                            flexDirection="row"
                            justifyContent="space-between"
                            gap={1}
                            backgroundColor={theme.background.raised.high}
                          >
                            <text
                              fg={entry().continues ? theme.text.action.primary.base : theme.text.muted}
                              wrapMode="none"
                              flexGrow={1}
                              minWidth={0}
                            >
                              {Locale.truncateWidth(
                                entry().label,
                                Math.max(0, state.columnWidth() - 3 - stringWidth(entry().key)),
                              )}
                            </text>
                            <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none" flexShrink={0}>
                              {entry().key}
                            </text>
                          </box>
                        )}
                      </Show>
                    )}
                  </For>
                </box>
              )
            }}
          </For>
        </Show>
      </box>
    </box>
  )
}

function Tabs(props: { state: State; theme: Theme }) {
  const state = props.state
  const theme = props.theme
  return (
    <Show
      when={state.contentWidth() >= 64}
      fallback={
        <box height={1} width="100%" flexShrink={0} flexDirection="row" gap={2}>
          <text fg={theme.text.action.primary.base} attributes={TextAttributes.BOLD} wrapMode="none">
            {"‹ "}
            {state.activeSection() ?? "No bindings"}
            {" ›"}
          </text>
          <text fg={theme.text.muted} wrapMode="none">
            {state.groups().length ? `${state.activeSectionIndex() + 1}/${state.groups().length}` : ""}
          </text>
        </box>
      }
    >
      <box height={1} width="100%" flexShrink={0} flexDirection="row" gap={1}>
        <For each={state.groups()}>
          {(group) => {
            const selected = createMemo(() => state.activeSection() === group.label)
            return (
              <box
                height={1}
                flexShrink={0}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={selected() ? theme.background.action.primary.focused : undefined}
                onMouseDown={() => state.jumpTo(group.label)}
              >
                <text
                  fg={selected() ? theme.text.action.primary.focused : theme.text.muted}
                  attributes={selected() ? TextAttributes.BOLD : undefined}
                  wrapMode="none"
                >
                  {group.label}
                </text>
              </box>
            )
          }}
        </For>
        <Show when={state.scrollable()}>
          <box flexGrow={1} />
          <text fg={theme.text.action.primary.base} wrapMode="none" flexShrink={0}>
            ↑↓
          </text>
        </Show>
      </box>
    </Show>
  )
}

function Popup(props: { state: State }) {
  const state = props.state
  const theme = useTheme().surface("dialog")
  const left = () => `${state.shortcut(commands.previousGroup)} / ${state.shortcut(commands.nextGroup)} sections`
  const right = () => `${state.shortcut(commands.toggle)} close`
  return (
    <DialogLayout
      header={
        <DialogHeader
          gap={2}
          titleView={
            <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none">
              {state.contentWidth() >= 30 ? "Keyboard shortcuts" : "Shortcuts"}
            </text>
          }
        >
          <Show when={state.contentWidth() >= 52}>
            <text fg={theme.text.muted} wrapMode="none">
              {state.entries().length} shortcuts
            </text>
          </Show>
        </DialogHeader>
      }
      footer={{
        children: (
          <box width="100%" flexDirection="row" justifyContent="space-between" gap={2}>
            <Show when={state.contentWidth() >= left().length + right().length + 4}>
              <text fg={theme.text.muted} wrapMode="none">
                {left()}
              </text>
            </Show>
            <box flexGrow={1} />
            <text fg={theme.text.muted} wrapMode="none" flexShrink={0}>
              {right()}
            </text>
          </box>
        ),
      }}
    >
      <Body state={state} mode="popup" theme={theme} />
    </DialogLayout>
  )
}

function Dock(props: { state: State }) {
  const state = props.state
  const theme = state.context.theme
  const left = () => `${state.shortcut(commands.previousGroup)} / ${state.shortcut(commands.nextGroup)} sections`
  const right = () =>
    `${state.layout()} · pending ${state.pendingPreview() ? "on" : "off"} · ${state.shortcut(commands.toggle)}`
  return (
    <box
      position="relative"
      zIndex={3500}
      width="100%"
      height={state.panelHeight()}
      flexShrink={0}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      border={["top"]}
      borderColor={theme.border.base}
      backgroundColor={theme.background.raised.base}
    >
      <box height={1} width="100%" flexShrink={0} flexDirection="row" justifyContent="space-between" gap={2}>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none">
          Keyboard shortcuts
        </text>
        <text fg={theme.text.muted} wrapMode="none">
          {state.entries().length} reachable
        </text>
      </box>
      <Body state={state} mode="dock" theme={theme} />
      <box height={1} flexShrink={0} />
      <box height={1} width="100%" flexShrink={0} flexDirection="row" justifyContent="space-between" gap={2}>
        <Show when={state.contentWidth() >= left().length + right().length + 4}>
          <text fg={theme.text.muted} wrapMode="none">
            {left()}
          </text>
        </Show>
        <text fg={theme.text.muted} wrapMode="none">
          {right()}
        </text>
      </box>
    </box>
  )
}

function Preview(props: { state: State }) {
  const state = props.state
  const theme = state.context.theme
  return (
    <box
      position="absolute"
      zIndex={3500}
      left={0}
      bottom={0}
      width="100%"
      height={state.panelHeight()}
      flexShrink={0}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      border={["top"]}
      borderColor={theme.border.base}
      backgroundColor={theme.background.raised.base}
    >
      <box height={2} flexShrink={0} flexDirection="column">
        <box height={1} width="100%" flexDirection="row" justifyContent="space-between" gap={1}>
          <text fg={theme.text.base} attributes={TextAttributes.BOLD} wrapMode="none">
            Pending:{" "}
            <span style={{ fg: theme.text.action.primary.selected }}>
              {state.keymap
                .pending()
                .map((item) => item.key)
                .join(" ")}
            </span>
          </text>
          <text fg={theme.text.muted} wrapMode="none">
            Choose a valid next key
          </text>
        </box>
        <text fg={theme.text.muted} wrapMode="none">
          {state.scrollable() ? "More valid keys below · scroll to reveal" : "Press a highlighted key to continue"}
        </text>
      </box>
      <box height={1} flexShrink={0} />
      <Body state={state} mode="preview" theme={theme} />
    </box>
  )
}

function WhichKey(props: { context: Plugin.Context }) {
  const state = createState(props.context)
  const dialog = useDialog()

  // The floating panel is a real dialog so typing cannot reach the composer behind it.
  createEffect(() => {
    if (!state.pinned() || state.layout() !== "popup") return
    // `dialog.replace` reads and writes the dialog store, which must not re-trigger this effect.
    untrack(() => {
      state.setSnapshot(state.liveEntries())
      dialog.replace(
        () => <Popup state={state} />,
        () => {
          if (state.layout() === "popup") state.setPinned(false)
        },
        { key: POPUP_DIALOG_KEY, size: POPUP_SIZE },
      )
      dialog.setCentered(true)
    })
  })

  createEffect(() => {
    if (state.pinned() && state.layout() === "popup") return
    untrack(() => {
      if (dialog.key === POPUP_DIALOG_KEY) dialog.clear()
    })
    state.setSnapshot(null)
  })

  onCleanup(() => {
    if (dialog.key === POPUP_DIALOG_KEY) dialog.clear()
  })

  return (
    <>
      <Show when={state.surface() === "dock"}>
        <Dock state={state} />
      </Show>
      <Show when={state.surface() === "preview"}>
        <Preview state={state} />
      </Show>
    </>
  )
}

export default Plugin.define({
  id: "opencode.which-key",
  setup(context) {
    context.ui.slot({
      append: "app",
      render: () => <WhichKey context={context} />,
    })
  },
})
