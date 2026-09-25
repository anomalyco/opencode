import { useDialog } from "../ui/dialog"
import { useRoute } from "../context/route"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { useEvent } from "../context/event"
import { useProject } from "../context/project"
import { useRenderer } from "@opentui/solid"
import { createEffect, createMemo, createResource, createSignal, on, onCleanup, batch, For, Show } from "solid-js"
import type { InputRenderable } from "@opentui/core"
import { TextAttributes } from "@opentui/core"
import { loadDialogSessionList } from "./dialog-session-list"
import { DialogSessionRename } from "./dialog-session-rename"
import { createDebouncedSignal } from "../util/signal"
import { useToast } from "../ui/toast"
import { Spinner } from "./spinner"
import { errorMessage } from "../util/error"
import { useBindings, useCommandShortcut, useOpencodeModeStack } from "../keymap"
import { getScrollAcceleration } from "../util/scroll"
import { Locale } from "../util/locale"
import { useTuiConfig } from "../config"

const DAY = 24 * 60 * 60 * 1000

export function groupLabel(updated: number) {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (updated >= startOfToday) return "Today"
  if (updated >= startOfToday - DAY) return "Yesterday"
  if (updated >= startOfToday - 6 * DAY) return "7 days"
  return "Older"
}

export function reanchor(cursor: number, anchor: string | undefined, sessions: { id: string }[]) {
  if (sessions.length === 0) return 0
  const index = anchor ? sessions.findIndex((session) => session.id === anchor) : -1
  if (index >= 0) return index
  return Math.min(Math.max(cursor, 0), sessions.length - 1)
}

export function SessionHistoryRail(props: { focused: () => boolean; onFocus: () => void; onUnfocus: () => void }) {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const { theme } = useTheme()
  const sdk = useSDK()
  const event = useEvent()
  const project = useProject()
  const toast = useToast()
  const tuiConfig = useTuiConfig()
  const renderer = useRenderer()
  const modeStack = useOpencodeModeStack()

  const [toDelete, setToDelete] = createSignal<string>()
  const [deleted, setDeleted] = createSignal(new Set<string>())
  const [search, setSearch] = createDebouncedSignal("", 150)
  const [searchOpen, setSearchOpen] = createSignal(false)
  const [cursor, setCursor] = createSignal(0)
  let anchor: string | undefined
  const deleteHint = useCommandShortcut("session.rail.delete")
  const renameHint = useCommandShortcut("session.rail.rename")
  const searchHint = useCommandShortcut("session.rail.search")
  const unfocusHint = useCommandShortcut("session.rail.unfocus")

  const [browseResults, { refetch: refetchBrowse }] = createResource(
    () => sync.session.query(),
    (filter) => loadDialogSessionList({ filter, list: (query) => sdk.client.session.list(query) }),
  )
  const [searchResults, { refetch }] = createResource(
    () => ({ query: search(), filter: sync.session.query() }),
    (input) => {
      if (!input.query) return undefined
      return loadDialogSessionList({
        search: input.query,
        filter: input.filter,
        list: (query) => sdk.client.session.list(query),
      })
    },
  )

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const sessions = createMemo(() => {
    const result = searchResults() ?? browseResults() ?? sync.data.session
    const synced = new Map(sync.data.session.map((session) => [session.id, session]))
    return result
      .map((session) => synced.get(session.id) ?? session)
      .filter((session) => !deleted().has(session.id))
      .filter((x) => x.parentID === undefined)
      .toSorted((a, b) => b.time.updated - a.time.updated)
  })

  const groups = createMemo(() =>
    sessions().reduce<{ label: string; items: ReturnType<typeof sessions>[number][] }[]>((acc, session) => {
      const label = groupLabel(session.time.updated)
      const last = acc.at(-1)
      if (last?.label === label) {
        last.items.push(session)
        return acc
      }
      return [...acc, { label, items: [session] }]
    }, []),
  )
  const selectedID = createMemo(() => sessions()[cursor()]?.id)

  createEffect(
    on(sessions, (list) => {
      const index = reanchor(cursor(), anchor, list)
      setCursor(index)
      const id = list[index]?.id
      if (id !== anchor) setToDelete(undefined)
      anchor = id
    }),
  )

  onCleanup(
    event.on("session.deleted", (evt) => {
      setDeleted((current) => new Set(current).add(evt.properties.info.id))
    }),
  )

  onCleanup(
    event.on("session.created", () => {
      void refetchBrowse()
    }),
  )

  createEffect(() => {
    if (!props.focused()) return
    const focused = renderer.currentFocusedRenderable
    if (focused) renderer.blurRenderable(focused)
    const popMode = modeStack.push("session_rail")
    onCleanup(popMode)
  })

  let inputRef: InputRenderable | undefined

  function focusInput() {
    setTimeout(() => {
      if (!inputRef) return
      if (inputRef.isDestroyed) return
      inputRef.focus()
    }, 1)
  }

  function closeSearch() {
    if (inputRef && !inputRef.isDestroyed) inputRef.value = ""
    setSearchOpen(false)
    setSearch("")
    setCursor(0)
    anchor = sessions()[0]?.id
  }

  function move(direction: number) {
    const list = sessions()
    if (list.length === 0) return
    const next = Math.min(Math.max(cursor() + direction, 0), list.length - 1)
    setCursor(next)
    anchor = list[next]?.id
  }

  function openSession(sessionID: string) {
    route.navigate({ type: "session", sessionID })
    setToDelete(undefined)
    if (searchOpen()) closeSearch()
    anchor = sessionID
    const index = sessions().findIndex((session) => session.id === sessionID)
    if (index >= 0) setCursor(index)
    props.onUnfocus()
  }

  function openInput() {
    setSearchOpen(true)
    focusInput()
  }

  async function deleteSession(sessionID: string) {
    if (toDelete() !== sessionID) {
      setToDelete(sessionID)
      return
    }
    setToDelete(undefined)
    const session = sessions().find((item) => item.id === sessionID)
    const status = session?.workspaceID ? project.workspace.status(session.workspaceID) : undefined
    try {
      const result = await sdk.client.session.delete({ sessionID })
      if (result.error) {
        toast.show({
          variant: "error",
          title: "Failed to delete session",
          message: errorMessage(result.error),
        })
        return
      }
    } catch (err) {
      toast.show({
        variant: "error",
        title: "Failed to delete session",
        message: errorMessage(err),
      })
      return
    }
    if (status && status !== "connected") await sync.session.refresh()
    await refetchBrowse()
    if (search()) await refetch()
  }

  function renameSession(sessionID: string) {
    dialog.replace(() => <DialogSessionRename session={sessionID} />)
  }

  useBindings(() => ({
    mode: "session_rail",
    commands: [
      {
        name: "session.rail.unfocus",
        title: "Leave session history rail",
        run: () => {
          closeSearch()
          props.onUnfocus()
        },
      },
      {
        name: "session.rail.search",
        title: "Search in session history rail",
        run: openInput,
      },
      {
        name: "dialog.select.prev",
        title: "Previous session in rail",
        run: () => move(-1),
      },
      {
        name: "dialog.select.next",
        title: "Next session in rail",
        run: () => move(1),
      },
      {
        name: "dialog.select.submit",
        title: "Open selected session",
        run: () => {
          const session = sessions()[cursor()]
          if (session) openSession(session.id)
        },
      },
      {
        name: "session.rail.delete",
        title: "Delete selected session",
        run: () => {
          const session = sessions()[cursor()]
          if (session) void deleteSession(session.id)
        },
      },
      {
        name: "session.rail.rename",
        title: "Rename selected session",
        run: () => {
          const session = sessions()[cursor()]
          if (session) renameSession(session.id)
        },
      },
    ],
    bindings: tuiConfig.keybinds.gather("session_rail", [
      "session.rail.unfocus",
      "session.rail.search",
      "dialog.select.prev",
      "dialog.select.next",
      "dialog.select.submit",
      "session.rail.delete",
      "session.rail.rename",
    ]),
  }))

  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))

  return (
    <box
      width={30}
      height="100%"
      backgroundColor={theme.backgroundPanel}
      flexDirection="column"
      onMouseUp={() => props.onFocus()}
    >
      <box flexShrink={0} paddingLeft={2} paddingTop={1} paddingBottom={1}>
        <text fg={props.focused() ? theme.accent : theme.textMuted}>
          <b>Sessions</b>
        </text>
      </box>
      <Show when={searchOpen()}>
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <input
            ref={(r) => {
              inputRef = r
            }}
            onInput={(value) => {
              batch(() => {
                setSearch(value)
                setCursor(0)
              })
            }}
            focusedBackgroundColor={theme.backgroundPanel}
            cursorColor={theme.primary}
            cursorStyle={tuiConfig.cursor}
            focusedTextColor={theme.text}
            placeholder="Search sessions"
            placeholderColor={theme.textMuted}
          />
        </box>
      </Show>
      <scrollbox
        flexGrow={1}
        scrollAcceleration={scrollAcceleration()}
        verticalScrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.background,
            foregroundColor: theme.borderActive,
          },
        }}
      >
        <box flexShrink={0} flexDirection="column">
          <For each={groups()}>
            {(group) => (
              <box flexShrink={0} flexDirection="column">
                <text fg={theme.textMuted} paddingLeft={2}>
                  {group.label}
                </text>
                <For each={group.items}>
                  {(session) => {
                    const isDeleting = () => toDelete() === session.id
                    const isCurrent = () => currentSessionID() === session.id
                    const isSelected = () => selectedID() === session.id
                    const isWorking = () => {
                      const status = sync.data.session_status?.[session.id]
                      return status?.type === "busy" || status?.type === "retry"
                    }
                    return (
                      <box
                        flexShrink={0}
                        flexDirection="row"
                        paddingLeft={2}
                        paddingRight={1}
                        backgroundColor={isDeleting() ? theme.error : isSelected() ? theme.backgroundElement : undefined}
                        onMouseUp={(evt) => {
                          evt.stopPropagation()
                          openSession(session.id)
                        }}
                      >
                        <Show when={isWorking()}>
                          <box marginRight={1}>
                            <Spinner />
                          </box>
                        </Show>
                        <text
                          fg={isCurrent() ? theme.accent : theme.text}
                          attributes={isCurrent() || isSelected() ? TextAttributes.BOLD : undefined}
                        >
                          {isDeleting() ? `Press ${deleteHint()} again to confirm` : Locale.truncate(session.title, 26)}
                        </text>
                      </box>
                    )
                  }}
                </For>
              </box>
            )}
          </For>
        </box>
      </scrollbox>
      <Show when={props.focused()}>
        <box flexShrink={0} paddingLeft={2} paddingBottom={1}>
          <text fg={theme.textMuted}>
            {searchHint()} search {renameHint()} rename {deleteHint()} delete {unfocusHint()} close
          </text>
        </box>
      </Show>
    </box>
  )
}
