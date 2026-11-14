import { CliRenderEvents, MouseButton, TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import fuzzysort from "fuzzysort"
import path from "node:path"
import type { SessionInfo } from "@opencode/client"
import { displayLabel } from "@opencode/util/session-title-fallback"
import { batch, createEffect, createMemo, createResource, createSignal, Index, onCleanup, Show } from "solid-js"
import { useConfig, useCursorStyle } from "../config"
import { useClient } from "../context/client"
import { useData } from "../context/data"
import { Keymap } from "../context/keymap"
import { useRoute } from "../context/route"
import { useSessionTabs } from "../context/session-tabs"
import { useTheme } from "../context/theme"
import { DIALOG_INSET, DialogFooter, DialogHeader, drawerWidth, useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { moveSelection } from "../ui/select-controller"
import { getScrollAcceleration } from "../util/scroll"
import { type InboxRow, useInbox } from "./inbox-data"
import { inboxStatus } from "./inbox-status"
import { Spinner } from "./spinner"

export const DialogInboxKey = Symbol("DialogInbox")

type Entry = { key: string; section: string; count: number; row?: InboxRow }

export function DialogInbox() {
  const inbox = useInbox()
  const client = useClient()
  const sessions = useData().session
  const toast = useToast()
  const theme = useTheme().surface("dialog")
  const tabs = useSessionTabs()
  const route = useRoute()
  const dialog = useDialog()
  const config = useConfig().data
  const cursor = useCursorStyle()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const width = () => drawerWidth(dimensions().width)
  const [query, setQuery] = createSignal("")
  const [folds, setFolds] = createSignal(new Set<string>())
  const [searchFolds, setSearchFolds] = createSignal(new Set<string>())
  const collapsed = () => (query() ? searchFolds() : folds())
  const [key, setKey] = createSignal(tabs.current())
  const [archived, setArchived] = createSignal(false)
  const [archivedPage] = createResource(archived, () =>
    client.api.session.list({ parentID: null, archived: true, order: "desc", limit: 50 }).then((page) => page.data),
  )
  let scroll: ScrollBoxRenderable | undefined

  const archivedSections = createMemo(() => {
    const rows = (archivedPage.latest ?? [])
      .map((session) => sessions.get(session.id) ?? session)
      .filter((session): session is SessionInfo => session.time.archived !== undefined)
      .map(
        (session): InboxRow => ({
          id: session.id,
          title: displayLabel(session),
          directory: session.location.directory,
          detail: "",
        }),
      )
    return [{ title: "Archived", rows }]
  })
  const entries = createMemo(() =>
    (archived() ? archivedSections() : inbox.sections()).flatMap((section): Entry[] => {
      const rows = query()
        ? fuzzysort
            .go(query(), section.rows, {
              keys: ["title", "directory", (row) => `${section.title} ${row.detail}`],
            })
            .map((hit) => hit.obj)
        : section.rows
      if (!rows.length) return []
      const header = { key: section.title, section: section.title, count: rows.length }
      return collapsed().has(section.title)
        ? [header]
        : [header, ...rows.map((row) => ({ ...header, key: row.id, row }))]
    }),
  )
  const selected = createMemo(
    () => entries().find((entry) => entry.key === key()) ?? entries().find((entry) => entry.row) ?? entries()[0],
  )
  createEffect(() => {
    const entry = selected()
    if (!entry) return
    setKey(entry.key)
    const index = entries().indexOf(entry)
    // Each section after the first has a blank line above its header.
    const line =
      index +
      entries()
        .slice(1, index + 1)
        .filter((item) => !item.row).length
    // The data can arrive before the scroll viewport has its measured height.
    const reveal = () => {
      if (!scroll || scroll.isDestroyed) return
      if (line < scroll.scrollTop) scroll.scrollTo(line)
      if (line >= scroll.scrollTop + scroll.viewport.height) scroll.scrollTo(line - scroll.viewport.height + 1)
    }
    renderer.once(CliRenderEvents.FRAME, reveal)
    onCleanup(() => renderer.off(CliRenderEvents.FRAME, reveal))
  })

  function fold(section: string, close: boolean) {
    if (collapsed().has(section) === close) return
    const next = new Set(collapsed())
    if (close) next.add(section)
    else next.delete(section)
    batch(() => {
      setKey(section)
      const update = query() ? setSearchFolds : setFolds
      update(next)
    })
  }
  function open(entry = selected()) {
    if (!entry) return
    if (!entry.row) return fold(entry.section, !collapsed().has(entry.section))
    dialog.clear()
    if (tabs.enabled()) return tabs.select(entry.row.id)
    route.navigate({ type: "session", sessionID: entry.row.id })
  }
  function toggleArchived() {
    batch(() => {
      setArchived((value) => !value)
      setKey(undefined)
    })
  }
  function archive(entry = selected()) {
    const row = entry?.row
    if (!row) return
    void client.api.session.update({ sessionID: row.id, archived: !archived() }).catch(toast.error)
  }
  function move(delta: number) {
    const index = entries().findIndex((item) => item.key === selected()?.key)
    setKey(entries()[moveSelection(index, { count: entries().length, delta, policy: "wrap" })]?.key)
  }
  function section(delta: number) {
    const headers = entries().filter((item) => !item.row)
    const index = headers.findIndex((item) => item.section === selected()?.section)
    setKey(headers[moveSelection(index, { count: headers.length, delta, policy: "wrap" })]?.key)
  }
  const keymap = Keymap.use()
  // Escape is the overlay's top-level dismiss, ahead of selection handling and other modal layers.
  onCleanup(
    keymap.intercept(
      "key",
      ({ event }) => {
        if (event.name !== "escape") return
        event.preventDefault()
        event.stopPropagation()
        renderer.clearSelection()
        dialog.clear()
      },
      { priority: 102 },
    ),
  )
  Keymap.createLayer(() => ({
    mode: "modal",
    priority: 102,
    commands: [
      { id: "dialog.select.prev", run: () => move(-1) },
      { id: "dialog.select.next", run: () => move(1) },
      { id: "dialog.select.page_up", run: () => move(-10) },
      { id: "dialog.select.page_down", run: () => move(10) },
      {
        id: "dialog.select.home",
        run: () => {
          setKey(entries()[0]?.key)
        },
      },
      {
        id: "dialog.select.end",
        run: () => {
          setKey(entries().at(-1)?.key)
        },
      },
      { id: "dialog.select.submit", run: () => open() },
      { id: "inbox.session.archive", run: () => archive() },
      { id: "inbox.view.archived", run: toggleArchived },
      { bind: "alt+up", run: () => section(-1) },
      { bind: "alt+down", run: () => section(1) },
      {
        id: "inbox.section.collapse",
        run: () => {
          const entry = selected()
          if (entry) fold(entry.section, true)
        },
      },
      {
        id: "inbox.section.expand",
        run: () => {
          const entry = selected()
          if (entry) fold(entry.section, false)
        },
      },
    ],
  }))

  return (
    <box paddingX={1} paddingBottom={1} flexGrow={1} minHeight={0} gap={1}>
      <DialogHeader title={archived() ? "Archived" : "Inbox"} />
      <input
        focused
        cursorStyle={cursor()}
        cursorColor={theme.text.base}
        focusedTextColor={theme.text.base}
        focusedBackgroundColor={theme.background.formfield.focused}
        placeholderColor={theme.text.muted}
        placeholder={archived() ? "Search archived sessions…" : "Search inbox sessions…"}
        onInput={(value) =>
          batch(() => {
            setQuery(value.trim())
            setSearchFolds(new Set<string>())
            setKey(value.trim() ? undefined : tabs.current())
          })
        }
      />
      <scrollbox
        flexGrow={1}
        minHeight={0}
        ref={(r) => (scroll = r)}
        scrollAcceleration={getScrollAcceleration(config)}
        scrollbarOptions={{ visible: false }}
      >
        <Show
          when={entries().length}
          fallback={
            <text fg={theme.text.muted}>
              {(archived() ? archivedPage.loading : inbox.loading())
                ? "Loading sessions…"
                : query()
                  ? "No matching sessions"
                  : archived()
                    ? "No archived sessions"
                    : "No inbox sessions"}
            </text>
          }
        >
          <Index each={entries()}>
            {(entry, index) => {
              const active = () => selected()?.key === entry().key
              return (
                <box
                  width="100%"
                  height={1}
                  marginTop={index > 0 && !entry().row ? 1 : 0}
                  flexShrink={0}
                  flexDirection="row"
                  gap={1}
                  backgroundColor={active() ? theme.background.raised.high : undefined}
                  onMouseMove={() => setKey(entry().key)}
                  onMouseDown={(event) => {
                    if (event.button === MouseButton.LEFT) event.preventDefault()
                  }}
                  onMouseUp={(event) => {
                    if (event.button === MouseButton.LEFT) open(entry())
                  }}
                >
                  <text width={1} fg={theme.text.formfield.focused}>
                    {active() ? "▌" : " "}
                  </text>
                  <Show
                    when={entry().row}
                    fallback={
                      <text fg={theme.text.base} wrapMode="none" truncate>
                        <b>
                          {collapsed().has(entry().section) ? "▸ " : "▾ "}
                          {entry().section}
                        </b>
                        <span style={{ fg: theme.text.muted }}> {entry().count}</span>
                      </text>
                    }
                  >
                    {(row) => {
                      const status = createMemo(() => inboxStatus(theme, row().detail))
                      return (
                        <>
                          <Show when={status().spinner}>
                            <box marginLeft={2} flexShrink={0}>
                              <Spinner color={status().color} />
                            </box>
                          </Show>
                          <text
                            marginLeft={status().spinner ? 0 : 2}
                            minWidth={0}
                            flexBasis={0}
                            flexShrink={1}
                            flexGrow={1}
                            height={1}
                            truncate
                            wrapMode="none"
                            fg={theme.text.base}
                            attributes={tabs.current() === row().id ? TextAttributes.BOLD : undefined}
                          >
                            <Show when={status().marker}>
                              {(marker) => <span style={{ fg: status().color }}>{marker() + " "}</span>}
                            </Show>
                            {row().title}
                          </text>
                          <Show when={status().label}>
                            <text flexShrink={0} wrapMode="none" fg={status().color}>
                              {status().label}
                            </text>
                          </Show>
                          <Show when={width() >= 84 || (query() && width() >= 64)}>
                            <text
                              width={Math.min(26, Math.floor(width() / 3))}
                              flexShrink={0}
                              height={1}
                              truncate
                              wrapMode="none"
                              fg={theme.text.muted}
                            >
                              Dir: {path.basename(row().directory) || row().directory}
                            </text>
                          </Show>
                        </>
                      )
                    }}
                  </Show>
                </box>
              )
            }}
          </Index>
        </Show>
      </scrollbox>
      <Show when={selected()}>
        {(entry) => (
          <box paddingX={DIALOG_INSET - 1}>
            <DialogFooter
              actions={{
                secondary: [
                  {
                    title: archived() ? "inbox" : "archived",
                    command: "inbox.view.archived",
                    onTrigger: toggleArchived,
                  },
                  ...(collapsed().has(entry().section)
                    ? [
                        {
                          title: "expand",
                          command: "inbox.section.expand",
                          onTrigger: () => fold(entry().section, false),
                        },
                      ]
                    : [
                        {
                          title: "collapse",
                          command: "inbox.section.collapse",
                          onTrigger: () => fold(entry().section, true),
                        },
                      ]),
                ],
                primary: entry().row
                  ? [
                      {
                        title: archived() ? "restore" : "archive",
                        command: "inbox.session.archive",
                        onTrigger: () => archive(entry()),
                      },
                      { title: "open", command: "dialog.select.submit", onTrigger: () => open() },
                    ]
                  : [],
              }}
            />
          </box>
        )}
      </Show>
    </box>
  )
}
