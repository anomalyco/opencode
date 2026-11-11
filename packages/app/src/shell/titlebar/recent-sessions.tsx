import { isSessionNotFoundError, type SessionInfo } from "@opencode/client/promise"
import { Accessibility, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { Key } from "@solid-primitives/keyed"
import { useQueryClient } from "@tanstack/solid-query"
import { Button } from "@opencode/ui/button"
import { useDialog, useDialogLayer } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Loader } from "@opencode/ui/loader"
import { Menu } from "@opencode/ui/menu"
import { Schema } from "effect"
import { batch, createEffect, createMemo, onCleanup, Show, startTransition, untrack } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { arrayMove } from "@/runtime/array-move"
import { useLanguage } from "@/runtime/i18n/language"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal, type ServerCtx } from "@/runtime/server/runtime"
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
import { errorMessage } from "@/shell/layout/helpers"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import { showToast } from "@/shell/notifications/toast"
import { setSidebarUnread } from "@/shell/sidebar-peek"
import { useLayout } from "@/shell/state/layout"
import { tabHref, useTabs } from "@/shell/tabs/tabs"
import {
  addPin,
  dedupePins,
  INITIAL_RECENT_PAGE_STATE,
  RECENT_PAGE_LIMIT,
  RECENT_VISIBLE_LIMIT,
  mergeRecentSessions,
  partitionRecentSessions,
  recentPageFailed,
  recentPageHasMore,
  recentPageLoaded,
  recentSessionEndpoints,
  recentSessionKey,
  removePin,
  reorderPins,
  splitRecentSessionKey,
  transitionRecentPage,
  windowRecentSessions,
  type RecentPageEffect,
  type RecentPageEvent,
  type RecentPageState,
  type RecentSession,
} from "./recent-sessions-model"
import { notifySessionTabsRemoved } from "./session-events"
import { TabNavItem } from "./tab-nav"
import { createSessionRowNavigation, syncInactiveSession } from "./tab-strip"
import { sessionTabTitle } from "./tab-title"

const RecentSidebarState = Persistence.struct({
  // Ordered `${server}\u0000${sessionID}` keys. Local to this desktop.
  pins: Persistence.array(Schema.String),
})

type Connection = { conn: ServerConnection.Any; ctx: ServerCtx; server: ServerConnection.Key }

/**
 * The experimental Recent sessions sidebar: pinned sessions first, then every server's root sessions from the last
 * 7 days in one recency list, at most 30 until Show more reveals older ones. The desktop titlebar renders it in place of the side tabs only while the setting is on and available.
 */
export function RecentSessions() {
  const global = useGlobal()
  const servers = useServers()
  const language = useLanguage()
  const layout = useLayout()
  const tabs = useTabs()
  const dialog = useDialog()
  const queryClient = useQueryClient()

  const [state, setState, , ready] = persisted(Persist.global("sidebar.recent"), RecentSidebarState, { pins: [] })

  const [pages, setPages] = createStore<Record<string, RecentPageState>>({})

  const [hydration, setHydration] = createStore<Record<string, SessionInfo>>({})

  // Whether each row shows its unread dot, keyed like the rows.
  const [unread, setUnread] = createStore<Record<string, boolean>>({})

  // `revealed` counts the rows Show more added beyond the 7-day window. `now` ticks each minute so the window moves.
  const [view, setView] = createStore({ revealed: 0, now: Date.now() })

  const clock = setInterval(() => setView("now", Date.now()), 60_000)
  onCleanup(() => clearInterval(clock))

  const controllers = new Map<AbortController, string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const hydrationControllers = new Map<string, AbortController>()
  const statuses = new Map<string, { ctx: ServerCtx; status: string }>()
  let attempt = 0
  let disposed = false

  const connections = createMemo(() =>
    servers.visible.flatMap((conn): Connection[] => {
      const server = ServerConnection.key(conn)
      const ctx = global.serverCtx(server)

      return ctx ? [{ conn, ctx, server }] : []
    }),
  )

  const ctxOf = (item: RecentSession) => global.serverCtx(ServerConnection.Key.make(item.server))

  const isCurrent = (item: Connection) =>
    connections().some((entry) => entry.server === item.server && entry.ctx === item.ctx)

  const clearTimer = (server: string) => {
    const timer = timers.get(server)

    if (timer === undefined) return

    clearTimeout(timer)
    timers.delete(server)
  }

  const abortPages = (server: string) => {
    controllers.forEach((owner, controller) => {
      if (owner === server) controller.abort()
    })
  }

  const abortHydration = (server?: string) => {
    hydrationControllers.forEach((controller, key) => {
      if (server && splitRecentSessionKey(key)?.server !== server) return

      controller.abort()

      if (server) hydrationControllers.delete(key)
    })
  }

  const clearHydration = (server: string) => {
    setHydration(
      produce((current) => {
        for (const key of Object.keys(current)) {
          if (splitRecentSessionKey(key)?.server === server) delete current[key]
        }
      }),
    )
  }

  function rememberPin(item: Connection, key: string, info: SessionInfo) {
    batch(() => {
      if (item.ctx.data.session.get(info.id)) item.ctx.data.session.remember(info)
      setHydration(key, reconcile(info))
    })
  }

  function hydrate(item: Connection, key: string, sessionID: string) {
    if (disposed || hydrationControllers.has(key)) return

    const controller = new AbortController()
    hydrationControllers.set(key, controller)

    void item.ctx.sdk.api.session
      .get({ sessionID }, { signal: controller.signal })
      .then(
        (response) => {
          if (controller.signal.aborted || disposed) return

          if (!isCurrent(item)) return

          rememberPin(item, key, response)
        },
        (cause) => {
          if (controller.signal.aborted || disposed) return

          if (!isCurrent(item)) return

          if (!isSessionNotFoundError(cause)) return

          batch(() => {
            item.ctx.data.session.forget(sessionID)
            forget(item.server, sessionID)
            setHydration(produce((cache) => void delete cache[key]))
            removePinKey(key)
          })
        },
      )
      .finally(() => {
        if (hydrationControllers.get(key) !== controller) return

        hydrationControllers.delete(key)
      })
  }

  // A server that leaves the visible list owns no rows or hydration; its pins stay for when it returns.
  const dropServer = (server: string) => {
    abortPages(server)
    abortHydration(server)
    clearTimer(server)
    setPages(produce((current) => void delete current[server]))
    clearHydration(server)
  }

  function runEffect(item: Connection, effect: RecentPageEffect) {
    if (effect.type === "timer.cancel") {
      clearTimer(item.server)

      return
    }

    if (effect.type === "timer.start") {
      clearTimer(item.server)
      timers.set(
        item.server,
        setTimeout(() => {
          timers.delete(item.server)
          dispatch(item, { type: "timed-out", attempt: effect.attempt })
        }, effect.delayMs),
      )

      return
    }

    // A new fetch supersedes the previous page request for this server.
    abortPages(item.server)

    const controller = new AbortController()
    controllers.set(controller, item.server)

    void item.ctx.sdk.api.session
      .list(
        effect.cursor
          ? { cursor: effect.cursor, limit: RECENT_PAGE_LIMIT }
          : { parentID: null, archived: false, order: "desc", limit: RECENT_PAGE_LIMIT },
        { signal: controller.signal },
      )
      .then(
        (response) => {
          if (controller.signal.aborted || disposed) return

          if (!isCurrent(item)) return

          const page = pages[item.server]

          if (page?.status !== "loading" || page.attempt !== effect.attempt) return

          batch(() => {
            if (page.kind === "refresh") {
              const covered = new Map(response.data.map((info) => [info.id, info]))

              for (const key of state.pins) {
                const pin = splitRecentSessionKey(key)

                if (pin?.server !== item.server) continue
                const info = covered.get(pin.sessionID)

                if (info) rememberPin(item, key, info)
                else hydrate(item, key, pin.sessionID)
              }
            }

            dispatch(item, {
              type: "succeeded",
              attempt: effect.attempt,
              sessions: response.data,
              next: response.cursor.next ?? undefined,
            })
          })
        },
        () => {
          if (controller.signal.aborted || disposed) return

          if (!isCurrent(item)) return

          dispatch(item, { type: "failed", attempt: effect.attempt })
        },
      )
      .finally(() => controllers.delete(controller))
  }

  function dispatch(item: Connection, event: RecentPageEvent) {
    untrack(() => {
      const previous = pages[item.server] ?? INITIAL_RECENT_PAGE_STATE
      const next = transitionRecentPage(previous, event)

      if (next.state !== previous) setPages(item.server, reconcile(next.state))
      next.effects.forEach((effect) => runEffect(item, effect))
    })
  }

  function load(item: Connection, kind: "first" | "next" | "refresh") {
    dispatch(item, { type: "load", kind, attempt: ++attempt })
  }

  onCleanup(() => {
    disposed = true
    controllers.forEach((_, controller) => controller.abort())
    hydrationControllers.forEach((controller) => controller.abort())
    timers.forEach((timer) => clearTimeout(timer))
  })

  // The store is local and long-lived; drop duplicates a previous version or a manual edit left behind.
  createEffect(() => {
    if (!ready()) return

    const normalized = dedupePins(state.pins)

    if (normalized.length !== state.pins.length) setState("pins", normalized)
  })

  // First pages follow connection state: load on the first connect, refresh the snapshot on every reconnect or
  // context replacement, and forget pages whose server no longer has a controller.
  createEffect(() => {
    const list = connections()
    const visible = new Set<string>(list.map((item) => item.server))

    list.forEach((item) => {
      const status = item.ctx.sdk.connection.status()
      const previous = statuses.get(item.server)
      const replaced = !!previous && previous.ctx !== item.ctx

      statuses.set(item.server, { ctx: item.ctx, status })

      // A replaced controller owns no old requests or pin snapshots, even before it reconnects.
      if (replaced) dropServer(item.server)

      if (status !== "connected") return

      if (!untrack(() => pages[item.server])) {
        load(item, "first")

        return
      }

      if (!replaced && previous?.status === status) return

      // Page one supplies the fresh records; only pins outside it need a separate get.
      abortHydration(item.server)
      load(item, "refresh")
    })

    for (const server of [...statuses.keys()]) {
      if (visible.has(server)) continue

      statuses.delete(server)
      dropServer(server)
    }
  })

  const items = createMemo(() =>
    connections().flatMap((item) => {
      const fetched = pages[item.server]

      return mergeRecentSessions(
        item.server,
        fetched?.sessions ?? [],
        item.ctx.data.session.known(),
        item.ctx.data.session.apply,
      )
    }),
  )

  const hydratedItems = createMemo(() => {
    const result = new Map<string, RecentSession>()

    connections().forEach((item) => {
      state.pins.forEach((key) => {
        const parsed = splitRecentSessionKey(key)

        if (!parsed || parsed.server !== item.server) return

        const value = hydration[key]

        if (!value) return

        const session = item.ctx.data.session.apply([value])[0]

        if (session) result.set(key, { key, server: item.server, session })
      })
    })

    return result
  })

  // Pinned sessions older than the fetched pages load one by one. Not-found pins are dropped, not resurrected.
  createEffect(() => {
    if (!ready()) return

    const loaded = new Set(items().map((item) => item.key))
    const list = connections()

    state.pins.forEach((key) => {
      if (loaded.has(key) || hydrationControllers.has(key) || hydration[key]) return
      const parsed = splitRecentSessionKey(key)

      if (!parsed) return

      const item = list.find((entry) => entry.server === parsed.server)

      if (!item) return

      if (item.ctx.sdk.connection.status() !== "connected") return

      if (!recentPageLoaded(pages[item.server])) return

      // A live entry that is archived is hidden and keeps its pin; one pending removal is already gone.
      if (item.ctx.data.session.get(parsed.sessionID)) return

      hydrate(item, key, parsed.sessionID)
    })
  })

  // Deleted sessions drop their pin so a later reload cannot show a row that no longer exists.
  createEffect(() => {
    connections().forEach((item) => {
      onCleanup(
        item.ctx.data.on("session.deleted", (event) => {
          const key = recentSessionKey(item.server, event.data.sessionID)
          hydrationControllers.get(key)?.abort()
          batch(() => {
            removePinKey(key)
            forget(item.server, event.data.sessionID)
            setHydration(produce((cache) => void delete cache[key]))
          })
        }),
      )
    })
  })

  // A hydrated pin has no live entry, so archive events must reach its snapshot or Pinned keeps showing it.
  createEffect(() => {
    connections().forEach((item) => {
      const update = (sessionID: string, archived: number | undefined) => {
        const key = recentSessionKey(item.server, sessionID)
        const value = hydration[key]

        if (!value) return

        setHydration(key, "time", "archived", archived)
      }

      onCleanup(
        item.ctx.data.on("session.archived", (event) => {
          update(event.data.sessionID, event.created)
          forget(item.server, event.data.sessionID)
        }),
      )
      onCleanup(
        item.ctx.data.on("session.unarchived", (event) => {
          update(event.data.sessionID, undefined)

          // Hydrated pins have no live record to leave the archived state behind.
          if (!item.ctx.data.session.get(event.data.sessionID)) {
            void item.ctx.data.session.sync(event.data.sessionID).catch(() => undefined)
          }
        }),
      )
    })
  })

  const archived = (key: string) => {
    const parsed = splitRecentSessionKey(key)

    if (!parsed) return true

    const live = global.serverCtx(ServerConnection.Key.make(parsed.server))?.data.session.get(parsed.sessionID)

    if (live) return live.time.archived !== undefined

    return hydration[key]?.time.archived !== undefined
  }

  const endpoints = createMemo(() => recentSessionEndpoints(servers.list, servers.ownUrl()))

  const openSessions = createMemo(
    () =>
      new Set(
        tabs.store.flatMap((tab) => (tab.type === "session" ? [recentSessionKey(tab.server, tab.sessionId)] : [])),
      ),
  )

  const partition = createMemo(() =>
    partitionRecentSessions({
      items: items(),
      pins: state.pins,
      endpoints: endpoints(),
      open: openSessions(),
      resolvePin: (key) => hydratedItems().get(key),
      archived,
    }),
  )

  const pinned = () => partition().pinned

  const windowed = createMemo(() =>
    windowRecentSessions({
      items: partition().recent,
      now: view.now,
      revealed: view.revealed,
      serversHaveMore: connections().some((item) => recentPageHasMore(pages[item.server])),
    }),
  )

  const recent = () => windowed().visible
  const rows = createMemo(() => [...pinned(), ...recent()])

  const firstPageLoading = createMemo(() => {
    if (!servers.hydrated()) return true

    // Adding a server should not blank the rows already shown while its first page loads.
    if (pinned().length > 0 || partition().recent.length > 0) return false

    return connections().some((item) => {
      if (item.ctx.sdk.connection.status() !== "connected") return false

      const value = pages[item.server]

      return !recentPageLoaded(value)
    })
  })

  const loadingMore = createMemo(() =>
    connections().some((item) => {
      const value = pages[item.server]

      return value?.status === "loading" && value.kind !== "first" && value.sessions.length > 0
    }),
  )

  const failed = createMemo(() => connections().some((item) => recentPageFailed(pages[item.server])))

  const retryFailed = () => {
    connections().forEach((item) => {
      if (!recentPageFailed(pages[item.server])) return

      if (item.ctx.sdk.connection.status() !== "connected") return

      dispatch(item, { type: "retry", attempt: ++attempt })
    })
  }

  const empty = createMemo(
    () => pinned().length === 0 && recent().length === 0 && !windowed().hasMore && !firstPageLoading(),
  )

  // Every server with a cursor loads its next page together, and the merged list re-sorts. Newly loaded rows can
  // therefore appear above rows already shown: one merged recency order is kept rather than holding rows back until
  // every server reaches the same age. A short page or a missing next cursor ends that server's list; a failed page
  // keeps its cursor so the next Show more retries it.
  const loadMore = (retry: boolean) => {
    connections().forEach((item) => {
      const current = pages[item.server]

      if (!current) return

      if (item.ctx.sdk.connection.status() !== "connected") return

      if (current.status === "failed") {
        if (retry) dispatch(item, { type: "retry", attempt: ++attempt })

        return
      }

      if (!recentPageHasMore(current)) return

      load(item, "next")
    })
  }

  const showMore = () => {
    setView("revealed", (value) => value + RECENT_VISIBLE_LIMIT)
    loadMore(true)
  }

  // Show more can reveal more rows than are loaded; fetch further pages until they are, or every server is exhausted.
  // A failed page waits for the next Show more instead of retrying here.
  createEffect(() => {
    if (view.revealed === 0 || loadingMore()) return

    if (windowed().limit <= partition().recent.length) return

    untrack(() => loadMore(false))
  })

  const reorderPinned = (nextVisible: readonly string[]) => {
    const visible = pinned().map((item) => item.key)
    setState("pins", reorderPins(state.pins, visible, nextVisible))
  }

  const movePin = (key: string, offset: number) => {
    const visible = pinned().map((item) => item.key)
    const index = visible.indexOf(key)

    if (index === -1) return
    const target = index + offset

    if (target < 0 || target >= visible.length) return

    reorderPinned(arrayMove(visible, index, target))
  }

  const removePinKey = (key: string) => {
    const next = removePin(state.pins, key, endpoints())

    if (next.length !== state.pins.length) setState("pins", next)
  }

  // The fetched page is a separate cache. Archive and delete drop a row so it does not linger when the live store
  // never held it.
  const forget = (server: string, sessionID: string) => {
    setPages(server, (current) =>
      current ? { ...current, sessions: current.sessions.filter((session) => session.id !== sessionID) } : current,
    )
  }

  const selected = (item: RecentSession) => {
    const route = layout.route()

    if (route.type !== "session") return false
    const scope = endpoints()

    if ((scope.get(route.server) ?? route.server) !== (scope.get(item.server) ?? item.server)) return false

    return (
      route.sessionId === item.session.id ||
      global.serverCtx(route.server)?.data.session.root(route.sessionId) === item.session.id
    )
  }

  const open = (item: RecentSession) => {
    const ctx = ctxOf(item)

    if (!ctx) return

    const current = ctx.data.session.get(item.session.id) ?? item.session
    const directory = ctx.projects.forSession(current)?.worktree ?? current.location.directory

    void ctx.data.session.message.sync(current.id).catch((cause) => {
      if (!isSessionNotFoundError(cause)) return

      removePinKey(item.key)
      forget(item.server, current.id)
    })
    void startTransition(() => {
      tabs.select(tabs.addSessionTab({ server: ServerConnection.Key.make(item.server), sessionId: current.id }))
      ctx.data.session.remember(current)
      ctx.projects.touch(directory)
    })
  }

  // Rows take the side tabs' shortcuts, numbered and stepped through in the order shown.
  const rowRefs = new Map<string, HTMLDivElement>()

  const hints = createSessionRowNavigation({
    keys: () => rows().map((item) => item.key),
    current: () => rows().find(selected)?.key,
    unread: (key) => !!unread[key],
    navigate: (key, reveal) => {
      const item = rows().find((entry) => entry.key === key)

      if (!item) return
      open(item)

      if (reveal) rowRefs.get(key)?.scrollIntoView({ behavior: "instant", block: "nearest" })
    },
  })

  // Tells the closed sidebar's toggle whether any row here shows its unread dot, which the selected row never does.
  createEffect(() => {
    setSidebarUnread(rows().some((item) => !selected(item) && !!unread[item.key]))
    onCleanup(() => setSidebarUnread(false))
  })

  const requestFailed = (cause: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description: errorMessage(cause, language.t("common.requestFailed")),
    })

  const invalidateSessionLists = (server: string) => {
    const conn = global.servers.list().find((entry) => ServerConnection.key(entry) === server)

    if (!conn) return

    for (const queryKey of ["home-sessions", "inbox-sessions", "inbox-archived-sessions"]) {
      void queryClient.invalidateQueries({ queryKey: [queryKey, conn], exact: true })
    }
  }

  const archive = (item: RecentSession) => {
    const ctx = ctxOf(item)

    if (!ctx) return

    void ctx.sdk.api.session
      .update({ sessionID: item.session.id, archived: true })
      .then(() => {
        if (state.pins.includes(item.key)) {
          setHydration(item.key, {
            ...item.session,
            time: { ...item.session.time, archived: item.session.time.archived ?? Date.now() },
          })
        }

        forget(item.server, item.session.id)
        invalidateSessionLists(item.server)
        notifySessionTabsRemoved({
          server: ServerConnection.Key.make(item.server),
          directory: item.session.location.directory,
          sessionIDs: [item.session.id],
        })
      })
      .catch(requestFailed)
  }

  const remove = (item: RecentSession) => {
    const ctx = ctxOf(item)

    if (!ctx) return

    const ids = sessionTreeIDs(ctx.data.session.list(), item.session.id)

    void ctx.data.session
      .remove(item.session.id)
      .then(() => {
        forget(item.server, item.session.id)
        removePinKey(item.key)
        notifySessionTabsRemoved({
          server: ServerConnection.Key.make(item.server),
          directory: item.session.location.directory,
          sessionIDs: ids,
        })
      })
      .catch((cause) =>
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(cause, language.t("session.delete.failed.title")),
        }),
      )
  }

  const row = (item: () => RecentSession, index?: () => number) => {
    const position = () => rows().findIndex((entry) => entry.key === item().key)
    const key = item().key

    onCleanup(() => rowRefs.delete(key))

    const props = {
      item,
      selected: () => selected(item()),
      shortcut: () => (position() >= 0 && position() < 9 ? position() + 1 : undefined),
      ref: (element: HTMLDivElement) => rowRefs.set(key, element),
      onUnreadChange: (value: boolean) => setUnread(item().key, value),
      pinned: index !== undefined,
      canMoveUp: () => index !== undefined && index() > 0,
      canMoveDown: () => index !== undefined && index() < pinned().length - 1,
      onOpen: () => open(item()),
      onPin: () => setState("pins", (current) => addPin(current, item().key)),
      onUnpin: () => removePinKey(item().key),
      onMoveUp: () => movePin(item().key, -1),
      onMoveDown: () => movePin(item().key, 1),
      onArchive: () => archive(item()),
      onDelete: () => {
        const current = item()

        void dialog.show(() => (
          <DeleteSessionDialog
            title={sessionTabTitle(current.session.title, language.t("command.session.new"))}
            onConfirm={() => remove(current)}
          />
        ))
      },
    }

    return index === undefined ? <RecentSessionSlot {...props} /> : <PinnedSessionRow {...props} index={index} />
  }

  return (
    <div
      data-slot="sidebar-recent"
      data-shortcut-hints={hints() ? "" : undefined}
      class="flex min-h-0 flex-1 flex-col [app-region:no-drag]"
    >
      <div data-scrollable class="no-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-1">
        <Show
          when={!firstPageLoading()}
          fallback={
            <div class="flex justify-center p-2">
              <Loader role="img" aria-hidden="false" aria-label={language.t("common.loading")} />
            </div>
          }
        >
          <Show when={pinned().length > 0}>
            <div role="group" aria-labelledby="sidebar-recent-pinned" class="flex shrink-0 flex-col gap-2 pb-2.5">
              <SectionHeader id="sidebar-recent-pinned" label={language.t("sidebar.recent.pinned")} />
              <DragDropProvider
                sensors={[
                  PointerSensor.configure({
                    activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
                  }),
                ]}
                modifiers={[RestrictToVerticalAxis]}
                plugins={(defaults) => [
                  ...defaults.filter((plugin) => plugin !== Accessibility),
                  Feedback.configure({ dropAnimation: null }),
                ]}
                onDragEnd={(event) => {
                  const source = event.operation.source

                  if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return

                  const visible = pinned().map((item) => item.key)
                  reorderPinned(arrayMove(visible, source.initialIndex, source.index))
                }}
              >
                <div data-titlebar-tab-list data-orientation="vertical" class="flex w-full min-w-0 flex-col">
                  <Key each={pinned()} by={(item) => item.key}>
                    {(item, index) => row(item, index)}
                  </Key>
                </div>
              </DragDropProvider>
            </div>
          </Show>
          <Show when={recent().length > 0 || windowed().hasMore}>
            <div role="group" aria-labelledby="sidebar-recent-list" class="flex shrink-0 flex-col gap-2 pb-2.5">
              <SectionHeader id="sidebar-recent-list" label={language.t("sidebar.recent.section.recent")} />
              <div data-titlebar-tab-list data-orientation="vertical" class="flex w-full min-w-0 flex-col">
                <Key each={recent()} by={(item) => item.key}>
                  {(item) => row(item)}
                </Key>
              </div>
              <Show when={windowed().hasMore && !loadingMore()}>
                <Button variant="ghost-muted" size="normal" class="w-full justify-start px-2" onClick={showMore}>
                  {language.t("sidebar.inbox.showMore")}
                </Button>
              </Show>
            </div>
          </Show>
          <Show when={empty()}>
            <div class="px-1.5 py-2 text-[13px] leading-4 text-v2-text-text-faint">
              {language.t("sidebar.recent.empty")}
            </div>
          </Show>
        </Show>
        <Show when={loadingMore()}>
          <div class="flex justify-center p-2">
            <Loader role="img" aria-hidden="false" aria-label={language.t("common.loading")} />
          </div>
        </Show>
        <Show when={failed() && !loadingMore()}>
          <div class="flex justify-center p-2">
            <Button variant="ghost-muted" size="small" onClick={retryFailed}>
              {language.t("common.retry")}
            </Button>
          </div>
        </Show>
      </div>
    </div>
  )
}

function SectionHeader(props: { id: string; label: string }) {
  return (
    <div
      id={props.id}
      class="flex h-6 shrink-0 items-center gap-1.5 px-2 text-[13px] leading-4 font-medium text-v2-text-text-muted"
    >
      <span class="min-w-0 truncate">{props.label}</span>
    </div>
  )
}

type RecentSessionTabProps = {
  item: () => RecentSession
  selected: () => boolean
  shortcut: () => number | undefined
  ref: (element: HTMLDivElement) => void
  onUnreadChange: (unread: boolean) => void
  pinned: boolean
  canMoveUp: () => boolean
  canMoveDown: () => boolean
  onOpen: () => void
  onPin: () => void
  onUnpin: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onArchive: () => void
  onDelete: () => void
}

function RecentSessionSlot(
  props: RecentSessionTabProps & { slotRef?: (element: HTMLDivElement) => void; dragging?: boolean },
) {
  return (
    <div
      ref={props.slotRef}
      data-titlebar-tab-slot
      data-orientation="vertical"
      data-active={props.selected()}
      class="relative flex w-full shrink-0"
    >
      <RecentSessionTab {...props} />
    </div>
  )
}

function PinnedSessionRow(props: RecentSessionTabProps & { index: () => number }) {
  const sortable = useSortable({
    get id() {
      return props.item().key
    },
    get index() {
      return props.index()
    },
  })

  return <RecentSessionSlot {...props} slotRef={sortable.ref} dragging={sortable.isDragSource()} />
}

// Renders the session as the side tabs do, from the same status, with the Recent menu and no close actions.
function RecentSessionTab(props: RecentSessionTabProps & { dragging?: boolean }) {
  const global = useGlobal()
  const language = useLanguage()

  const item = () => props.item()
  const server = () => ServerConnection.Key.make(item().server)

  const status = useSessionTabAvatarState(
    server,
    () => item().session.id,
    () => true,
    () => item().session,
  )

  // A busy session shows its progress indicator instead of the unread dot.
  const unread = createMemo(() => status.unread() && !status.loading())

  createEffect(() => props.onUnreadChange(unread()))

  // A permission or form asked before this window connected only shows once loaded, as for an unselected side tab.
  // Only running rows load it: an idle session cannot wait on either, and Recent lists far more sessions than tabs.
  createEffect(() => {
    const ctx = global.serverCtx(server())
    const id = item().session.id

    if (!ctx || props.selected() || !status.loading() || ctx.sdk.connection.status() !== "connected") return

    const timer = window.setTimeout(() => syncInactiveSession(ctx, id), 300)

    onCleanup(() => window.clearTimeout(timer))
  })

  const menu = (rename: () => void) => (
    <>
      <Show
        when={props.pinned}
        fallback={<Menu.Item onSelect={props.onPin}>{language.t("sidebar.recent.pin")}</Menu.Item>}
      >
        <Menu.Item onSelect={props.onUnpin}>{language.t("sidebar.recent.unpin")}</Menu.Item>
        <Menu.Item disabled={!props.canMoveUp()} onSelect={props.onMoveUp}>
          {language.t("sidebar.recent.moveUp")}
        </Menu.Item>
        <Menu.Item disabled={!props.canMoveDown()} onSelect={props.onMoveDown}>
          {language.t("sidebar.recent.moveDown")}
        </Menu.Item>
      </Show>
      <Menu.Separator />
      <Menu.Item onSelect={rename}>{language.t("common.rename")}</Menu.Item>
      <Menu.Item onSelect={props.onArchive}>{language.t("common.archive")}</Menu.Item>
      <Menu.Separator />
      <Menu.Item onSelect={props.onDelete}>{language.t("common.delete")}…</Menu.Item>
    </>
  )

  return (
    <TabNavItem
      ref={props.ref}
      href={tabHref({ type: "session", server: server(), sessionId: item().session.id })}
      server={server()}
      session={item().session}
      preparing={false}
      unread={unread()}
      attention={status.attention()}
      loading={status.loading()}
      shortcut={props.shortcut()}
      onNavigate={props.onOpen}
      active={props.selected()}
      dragging={!!props.dragging}
      orientation="vertical"
      menu={menu}
    />
  )
}

function DeleteSessionDialog(props: { title: string | undefined; onConfirm: () => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const layer = useDialogLayer()

  const close = () => dialog.close(layer?.id)

  const confirm = () => {
    if (dialog.closing) return
    close()
    props.onConfirm()
  }

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("session.delete.title")}
          description={language.t("session.delete.confirm", {
            name: props.title ?? language.t("command.session.new"),
          })}
        />
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost" autofocus disabled={dialog.closing} onClick={close}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="danger" disabled={dialog.closing} onClick={confirm}>
          {language.t("session.delete.button")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
