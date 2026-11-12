import {
  MouseButton,
  RenderableEvents,
  TextAttributes,
  type BoxRenderable,
  type ScrollBoxRenderable,
  type Renderable,
} from "@opentui/core"
import { createEffect, createMemo, createSignal, Index, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useConfig } from "../config"
import { Keymap } from "../context/keymap"
import { usePromptRef } from "../context/prompt"
import { useRoute } from "../context/route"
import { useSessionTabs } from "../context/session-tabs"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { moveSelection } from "../ui/select-controller"
import { getScrollAcceleration } from "../util/scroll"
import { useInbox } from "./inbox-data"
import { inboxStatus } from "./inbox-status"
import { Spinner } from "./spinner"

export function InboxSidebar() {
  const inbox = useInbox()
  const theme = useTheme()
  const config = useConfig().data
  const tabs = useSessionTabs()
  const route = useRoute()
  const dialog = useDialog()
  const prompt = usePromptRef()
  let pane!: BoxRenderable
  let scroll!: ScrollBoxRenderable
  let focusTimer: ReturnType<typeof setTimeout> | undefined
  const [focused, setFocused] = createSignal(false)
  const [cursor, setCursor] = createSignal<string>()
  const [collapsed, setCollapsed] = createStore<Record<string, boolean>>({})
  const [hovered, setHovered] = createSignal<{ section: () => string; target: Renderable }>()
  const sections = createMemo(() =>
    inbox.loading() ? [] : inbox.sections().filter((section) => section.rows.length > 0),
  )
  const empty = () => (inbox.loading() ? "Loading sessions…" : "No inbox sessions")
  const entries = createMemo(() =>
    focused()
      ? sections().flatMap(({ title, rows }) => [
          { key: title, section: title },
          ...(collapsed[title] ? [] : rows.map((row) => ({ key: row.id, section: title }))),
        ])
      : [],
  )
  const active = createMemo(() => entries().find((entry) => entry.key === cursor()) ?? entries()[0])
  createEffect(() => {
    const entry = active()
    if (entry) scroll.scrollChildIntoView(`inbox-${entry.key}`)
  })
  function leave() {
    pane.blur()
    prompt.current?.focus()
  }
  onCleanup(() => {
    clearTimeout(focusTimer)
    if (pane.focused) leave()
  })

  function move(delta: number) {
    const index = entries().findIndex((entry) => entry.key === active()?.key)
    setCursor(entries()[moveSelection(index, { count: entries().length, delta, policy: "clamp" })]?.key)
  }

  function fold(close: boolean) {
    const section = active()?.section
    if (!section) return
    setCursor(section)
    setCollapsed(section, close)
  }

  Keymap.createLayer(() => ({
    enabled: focused(),
    target: () => pane,
    priority: 10,
    commands: [
      { id: "dialog.select.prev", run: () => move(-1) },
      { id: "dialog.select.next", run: () => move(1) },
      { id: "inbox.section.collapse", run: () => fold(true) },
      { id: "inbox.section.expand", run: () => fold(false) },
      { bind: "escape", run: leave },
      {
        id: "dialog.select.submit",
        run: () => {
          const entry = active()
          if (!entry) return
          if (entry.key === entry.section) return fold(!collapsed[entry.section])
          leave()
          open(entry.key)
        },
      },
    ],
  }))

  Keymap.createLayer(() => ({
    // Folding a row under the pointer destroys the mouse target without a mouse-out event.
    enabled: () => !focused() && hovered()?.target.isDestroyed === false,
    priority: 10,
    commands: [
      { id: "inbox.section.collapse", run: () => setCollapsed(hovered()!.section(), true) },
      { id: "inbox.section.expand", run: () => setCollapsed(hovered()!.section(), false) },
    ],
  }))

  function open(id: string) {
    if (tabs.enabled()) return tabs.select(id)
    route.navigate({ type: "session", sessionID: id })
  }

  Keymap.createLayer(() => ({
    mode: "global",
    commands: [
      {
        id: "inbox.focus",
        title: "Focus Inbox",
        description: "Navigate Inbox sections and sessions",
        group: "Session",
        palette: true,
        run: () => {
          // The palette restores its previous focus on the next timer tick.
          clearTimeout(focusTimer)
          focusTimer = setTimeout(() => {
            setCursor(sections()[0]?.title)
            pane.focusable = true
            pane.focus()
          }, 1)
        },
      },
      {
        id: "inbox.session.open",
        title: "Open inbox session",
        group: "Session",
        palette: true,
        run: () =>
          dialog.replace(() => (
            <DialogSelect
              title="Inbox"
              placeholder="Search inbox sessions…"
              preserveSelection
              sectionNavigation
              emptyView={<text fg={theme.text.muted}>{empty()}</text>}
              options={sections().flatMap((section) =>
                section.rows.map((row) => {
                  const status = inboxStatus(theme.surface("dialog"), row.detail)
                  return {
                    title: row.title,
                    titleView: status.marker ? (
                      <span>
                        <span style={{ fg: status.color }}>{status.marker}</span>
                        {" " + row.title}
                      </span>
                    ) : undefined,
                    value: row.id,
                    category: section.title,
                    footer: status.label,
                    gutter: status.spinner ? (color) => <Spinner color={color} /> : undefined,
                    footerColor: status.color,
                    truncateTitle: true,
                    detail: `Location: ${row.directory}`,
                    searchText: `${row.directory} ${row.detail}`,
                  }
                }),
              )}
              current={tabs.current()}
              onSelect={(option) => {
                open(option.value)
                dialog.clear()
              }}
            />
          )),
      },
    ],
  }))

  return (
    <box
      id="inbox-sidebar"
      width="100%"
      height="100%"
      minHeight={0}
      backgroundColor={theme.background.raised.base}
      ref={(node) => {
        pane = node
        node.on(RenderableEvents.FOCUSED, () => setFocused(true))
        node.on(RenderableEvents.BLURRED, () => {
          setFocused(false)
          node.focusable = false
        })
      }}
    >
      <text marginLeft={2} marginTop={1} fg={theme.text.base} attributes={TextAttributes.BOLD}>
        Inbox
      </text>
      <scrollbox
        ref={(node) => (scroll = node)}
        flexGrow={1}
        minHeight={0}
        scrollAcceleration={getScrollAcceleration(config)}
        horizontalScrollbarOptions={{ visible: false }}
        verticalScrollbarOptions={{
          width: 1,
          trackOptions: { backgroundColor: theme.background.raised.base, foregroundColor: theme.scrollbar.base },
        }}
      >
        <Show
          when={sections().length}
          fallback={
            <text marginTop={1} marginLeft={2} fg={theme.text.muted}>
              {empty()}
            </text>
          }
        >
          <Index each={sections()}>
            {(section) => (
              <box
                flexShrink={0}
                marginTop={1}
                onMouseOver={(event) =>
                  event.target && setHovered({ section: () => section().title, target: event.target })
                }
                onMouseOut={() => setHovered(undefined)}
              >
                <text
                  id={`inbox-${section().title}`}
                  bg={active()?.key === section().title ? theme.background.formfield.focused : undefined}
                  marginLeft={2}
                  fg={theme.text.base}
                  selectable={false}
                  wrapMode="none"
                  truncate
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseUp={(event) => {
                    if (event.button !== MouseButton.LEFT) return
                    event.stopPropagation()
                    if (focused()) setCursor(section().title)
                    setCollapsed(section().title, (value) => !value)
                  }}
                >
                  <span style={{ fg: theme.text.muted }}>{collapsed[section().title] ? "▸ " : "▾ "}</span>
                  <b>{section().title}</b>
                  <span style={{ fg: theme.text.muted }}> {section().rows.length}</span>
                </text>
                <Show when={!collapsed[section().title]}>
                  <Index each={section().rows}>
                    {(row) => {
                      const [hover, setHover] = createSignal(false)
                      const current = () => tabs.current() === row().id
                      const status = createMemo(() => inboxStatus(theme, row().detail))
                      return (
                        <box
                          id={`inbox-${row().id}`}
                          height={1}
                          flexDirection="row"
                          flexShrink={0}
                          paddingLeft={2}
                          paddingRight={1}
                          backgroundColor={
                            active()?.key === row().id
                              ? theme.background.formfield.focused
                              : hover() || current()
                                ? theme.background.raised.high
                                : undefined
                          }
                          onMouseOver={() => setHover(true)}
                          onMouseOut={() => setHover(false)}
                          onMouseUp={(event) => {
                            if (event.button !== MouseButton.LEFT) return
                            event.stopPropagation()
                            open(row().id)
                          }}
                        >
                          <text
                            flexGrow={1}
                            flexBasis={0}
                            minWidth={0}
                            fg={theme.text.base}
                            selectable={false}
                            wrapMode="none"
                            truncate
                          >
                            <span style={{ fg: theme.text.formfield.selected }}>{current() ? "▸ " : "  "}</span>
                            <Show when={status().marker}>
                              {(marker) => <span style={{ fg: status().color }}>{marker() + " "}</span>}
                            </Show>
                            {row().title}
                          </text>
                          <Show when={status().spinner}>
                            <Spinner color={status().color} />
                          </Show>
                          <Show when={status().label}>
                            <text flexShrink={0} marginLeft={1} fg={status().color} selectable={false} wrapMode="none">
                              {status().label}
                            </text>
                          </Show>
                        </box>
                      )
                    }}
                  </Index>
                </Show>
              </box>
            )}
          </Index>
        </Show>
      </scrollbox>
    </box>
  )
}
