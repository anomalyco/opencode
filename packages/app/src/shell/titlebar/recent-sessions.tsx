import { isSessionNotFoundError, type SessionInfo } from "@opencode/client/promise"
import { Accessibility, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { Key } from "@solid-primitives/keyed"
import { useQueryClient } from "@tanstack/solid-query"
import { ActivityRing } from "@opencode/ui/activity-ring"
import { Button } from "@opencode/ui/button"
import { useDialog, useDialogLayer } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Loader } from "@opencode/ui/loader"
import { Menu } from "@opencode/ui/menu"
import { displayName } from "@opencode/ui/project-avatar"
import { Schema } from "effect"
import { createEffect, createMemo, createSignal, onCleanup, Show, startTransition } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { arrayMove } from "@/runtime/array-move"
import { useLanguage } from "@/runtime/i18n/language"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal, type ServerCtx } from "@/runtime/server/runtime"
import { createSessionRenamer } from "@/session/commands/rename-session"
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
import { errorMessage } from "@/shell/layout/helpers"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import { showToast } from "@/shell/notifications/toast"
import { useLayout } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { getRelativeTime } from "@/shell/time"
import { RenameDialog } from "./project-session-row"
import {
  addPin,
  dedupePins,
  INITIAL_RECENT_PAGE_STATE,
  mergeRecentSessions,
  partitionRecentSessions,
  recentPageFailed,
  recentPageHasMore,
  recentPageLoaded,
  recentSessionKey,
  removePin,
  reorderPins,
  sortRecentSessions,
  splitRecentSessionKey,
  transitionRecentPage,
  type RecentPageEffect,
  type RecentPageEvent,
  type RecentPageState,
  type RecentSession,
} from "./recent-sessions-model"
import { notifySessionTabsRemoved } from "./session-events"
import { sessionTabTitle } from "./tab-title"

// Root sessions fetched per server page.
const PAGE_LIMIT = 50

const RecentSidebarState = Persistence.struct({
  // Ordered `${server}\u0000${sessionID}` keys. Local to this desktop.
  pins: Persistence.array(Schema.String),
})

type Connection = { conn: ServerConnection.Any; ctx: ServerCtx; server: ServerConnection.Key }

type Hydration = { session: SessionInfo } | { missing: true }

/**
 * The experimental Recent sessions sidebar: pinned sessions first, then every server's newest root sessions in one
 * recency list. The desktop titlebar renders it in place of the side tabs only while the setting is on and available.
 */
export function RecentSessions() {
  const global = useGlobal()
  const servers = useServers()
  const language = useLanguage()
  const layout = useLayout()
  const tabs = useTabs()
  const dialog = useDialog()
  const queryClient = useQueryClient()

  const rename = createSessionRenamer()

  const [state, setState, , ready] = persisted(Persist.global("sidebar.recent"), RecentSidebarState, { pins: [] })

  const [pages, setPages] = createStore<Record<string, RecentPageState>>({})

  const [hydration, setHydration] = createStore<Record<string, Hydration>>({})

  const [clock, setClock] = createSignal(Date.now())

  const controllers = new Map<AbortController, string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const hydrationControllers = new Map<string, AbortController>()
  const hydrating = new Set<string>()
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
      hydrating.delete(key)

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

  function hydrate(item: Connection, key: string, sessionID: string) {
    if (disposed || hydrating.has(key)) return

    hydrating.add(key)

    const controller = new AbortController()
    hydrationControllers.set(key, controller)

    void item.ctx.sdk.api.session
      .get({ sessionID }, { signal: controller.signal })
      .then(
        (response) => {
          if (controller.signal.aborted || disposed) return

          if (!isCurrent(item)) return

          setHydration(key, { session: response })
        },
        (cause) => {
          if (controller.signal.aborted || disposed) return

          if (!isCurrent(item)) return

          if (!isSessionNotFoundError(cause)) return

          setHydration(key, { missing: true })
          removePinKey(key)
        },
      )
      .finally(() => {
        if (hydrationControllers.get(key) !== controller) return

        hydrationControllers.delete(key)
        hydrating.delete(key)
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
          ? { cursor: effect.cursor, limit: PAGE_LIMIT }
          : { parentID: null, archived: false, order: "desc", limit: PAGE_LIMIT },
        { signal: controller.signal },
      )
      .then(
        (response) => {
          if (controller.signal.aborted || disposed) return

          if (!isCurrent(item)) return

          dispatch(item, {
            type: "succeeded",
            attempt: effect.attempt,
            sessions: response.data,
            next: response.cursor.next ?? undefined,
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
    const previous = pages[item.server] ?? INITIAL_RECENT_PAGE_STATE
    const next = transitionRecentPage(previous, event)

    if (next.state !== previous) setPages(item.server, reconcile(next.state))
    next.effects.forEach((effect) => runEffect(item, effect))
  }

  function load(item: Connection, kind: "first" | "next" | "refresh") {
    dispatch(item, { type: "load", kind, attempt: ++attempt })
  }

  const ticker = setInterval(() => setClock(Date.now()), 60_000)
  onCleanup(() => {
    disposed = true
    clearInterval(ticker)
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
      if (replaced) {
        abortPages(item.server)
        abortHydration(item.server)
        clearTimer(item.server)
        clearHydration(item.server)
      }

      if (status !== "connected") return

      const current = pages[item.server]

      if (!current || current.status === "idle") {
        load(item, "first")

        return
      }

      if (!replaced && previous?.status === status) return

      // A reconnect or a new controller starts from a fresh snapshot and revalidates hydrated pins.
      abortHydration(item.server)
      clearHydration(item.server)
      state.pins.forEach((key) => {
        const parsed = splitRecentSessionKey(key)

        if (parsed?.server === item.server) hydrate(item, key, parsed.sessionID)
      })
      load(item, "refresh")
    })

    for (const server of [...statuses.keys()]) {
      if (visible.has(server)) continue

      statuses.delete(server)
      dropServer(server)
    }
  })

  const items = createMemo(() =>
    sortRecentSessions(
      connections().flatMap((item) => {
        const fetched = pages[item.server]

        return mergeRecentSessions(
          item.server,
          fetched ? item.ctx.data.session.apply(fetched.sessions) : [],
          item.ctx.data.session.list(),
        )
      }),
    ),
  )

  const hydratedItems = createMemo(() => {
    const result = new Map<string, RecentSession>()

    connections().forEach((item) => {
      state.pins.forEach((key) => {
        const parsed = splitRecentSessionKey(key)

        if (!parsed || parsed.server !== item.server) return

        const value = hydration[key]

        if (!value || "missing" in value) return

        const session = item.ctx.data.session.apply([value.session])[0]

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
      if (loaded.has(key) || hydrating.has(key) || hydration[key]) return
      const parsed = splitRecentSessionKey(key)

      if (!parsed) return

      const item = list.find((entry) => entry.server === parsed.server)

      if (!item) return

      if (item.ctx.sdk.connection.status() !== "connected") return

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
          removePinKey(recentSessionKey(item.server, event.data.sessionID))
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

        if (!value || "missing" in value) return

        setHydration(key, { session: { ...value.session, time: { ...value.session.time, archived } } })
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

    const value = hydration[key]

    if (!value || "missing" in value) return false

    return value.session.time.archived !== undefined
  }

  const partition = createMemo(() =>
    partitionRecentSessions({
      items: items(),
      pins: state.pins,
      resolvePin: (key) => hydratedItems().get(key),
      archived,
    }),
  )

  const pinned = () => partition().pinned
  const recent = () => partition().recent

  const firstPageLoading = createMemo(() => {
    if (!servers.hydrated()) return true

    // Adding a server should not blank the rows already shown while its first page loads.
    if (pinned().length > 0 || recent().length > 0) return false

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

  const empty = createMemo(() => pinned().length === 0 && recent().length === 0 && !firstPageLoading())

  // Every server with a cursor loads its next page together, and the merged list re-sorts. Newly loaded rows can
  // therefore appear above rows already shown: one merged recency order is kept rather than holding rows back until
  // every server reaches the same age. An empty page or a missing next cursor ends that server's list; a failed page
  // keeps its cursor so the next scroll retries it.
  const loadMore = () => {
    connections().forEach((item) => {
      const current = pages[item.server]

      if (!current) return

      if (item.ctx.sdk.connection.status() !== "connected") return

      if (current.status === "failed") {
        dispatch(item, { type: "retry", attempt: ++attempt })

        return
      }

      if (!recentPageHasMore(current)) return

      load(item, "next")
    })
  }

  let viewport: HTMLDivElement | undefined
  let fillFrame: number | undefined

  // A short list cannot scroll, so a scroll event never asks for the next page. Fill the viewport once per render
  // until rows overflow it or every server with a cursor is exhausted.
  createEffect(() => {
    connections().forEach((item) => pages[item.server]?.status)
    void items()

    if (fillFrame !== undefined) cancelAnimationFrame(fillFrame)
    fillFrame = requestAnimationFrame(() => {
      fillFrame = undefined

      if (disposed || !viewport || loadingMore()) return

      if (viewport.scrollHeight > viewport.clientHeight) return

      const more = connections().some((item) => {
        const current = pages[item.server]

        return current?.status === "ready" && recentPageHasMore(current)
      })

      if (more) loadMore()
    })
  })

  onCleanup(() => {
    if (fillFrame !== undefined) cancelAnimationFrame(fillFrame)
  })

  const reorderPinned = (nextVisible: readonly string[]) => {    const visible = pinned().map((item) => item.key)
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
    if (!state.pins.includes(key)) return

    setState("pins", (current) => removePin(current, key))
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

    if (route.type !== "session" || route.server !== item.server) return false

    return (
      route.sessionId === item.session.id ||
      ctxOf(item)?.data.session.root(route.sessionId) === item.session.id
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
            session: {
              ...item.session,
              time: { ...item.session.time, archived: item.session.time.archived ?? Date.now() },
            },
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

  const serverTag = (item: RecentSession) => {
    if (servers.visible.length < 2) return

    const conn = servers.visible.find((entry) => ServerConnection.key(entry) === item.server)

    return conn ? servers.tag(conn) : undefined
  }

  const row = (item: () => RecentSession, index?: () => number) => {
    const props = {
      item,
      selected: () => selected(item()),
      pinned: index !== undefined,
      serverTag: () => serverTag(item()),
      now: clock,
      canMoveUp: () => index !== undefined && index() > 0,
      canMoveDown: () => index !== undefined && index() < pinned().length - 1,
      onOpen: () => open(item()),
      onPin: () => setState("pins", (current) => addPin(current, item().key)),
      onUnpin: () => removePinKey(item().key),
      onMoveUp: () => movePin(item().key, -1),
      onMoveDown: () => movePin(item().key, 1),
      onRename: () => {
        const current = item()

        void dialog.show(() => (
          <RenameDialog
            title={sessionTabTitle(current.session.title, language.t("command.session.new"))}
            onRename={(title) => rename(ServerConnection.Key.make(current.server), current.session, title)}
          />
        ))
      },
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

    return index === undefined ? <RecentSessionRow {...props} /> : <PinnedSessionRow {...props} index={index} />
  }

  return (
    <div data-slot="sidebar-recent" class="flex min-h-0 flex-1 flex-col [app-region:no-drag]">
      <div
        ref={(element) => (viewport = element)}
        data-scrollable
        class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-1"
        onScroll={(event) => {
          const element = event.currentTarget

          if (element.scrollTop + element.clientHeight < element.scrollHeight - 160) return

          loadMore()
        }}
      >
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
                <Key each={pinned()} by={(item) => item.key}>
                  {(item, index) => row(item, index)}
                </Key>
              </DragDropProvider>
            </div>
          </Show>
          <Show when={recent().length > 0}>
            <div role="group" aria-labelledby="sidebar-recent-list" class="flex shrink-0 flex-col gap-2 pb-2.5">
              <SectionHeader id="sidebar-recent-list" label={language.t("sidebar.recent.section.recent")} />
              <Key each={recent()} by={(item) => item.key}>
                {(item) => row(item)}
              </Key>
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

type RecentSessionRowProps = {
  item: () => RecentSession
  selected: () => boolean
  pinned: boolean
  serverTag: () => string | undefined
  now: () => number
  canMoveUp: () => boolean
  canMoveDown: () => boolean
  onOpen: () => void
  onPin: () => void
  onUnpin: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
}

function PinnedSessionRow(props: RecentSessionRowProps & { index: () => number }) {
  const sortable = useSortable({
    get id() {
      return props.item().key
    },
    get index() {
      return props.index()
    },
  })

  return (
    <div ref={sortable.ref} class="relative shrink-0">
      <RecentSessionRow {...props} />
    </div>
  )
}

function RecentSessionRow(props: RecentSessionRowProps) {
  const language = useLanguage()
  const global = useGlobal()
  const dialog = useDialog()

  const item = () => props.item()
  const ctx = () => global.serverCtx(ServerConnection.Key.make(item().server))
  const project = () => ctx()?.projects.forSession(item().session)

  const status = useSessionTabAvatarState(
    () => ServerConnection.Key.make(item().server),
    () => item().session.id,
    () => true,
    () => item().session,
  )

  const title = () => sessionTabTitle(item().session.title, language.t("session.tab.session"))

  const age = () =>
    getRelativeTime(
      new Date(item().session.time.updated ?? item().session.time.created).toISOString(),
      language.t,
      language.intl(),
      props.now(),
    )

  return (
    <Menu.Context modal={false}>
      <Menu.Context.Trigger
        as="button"
        type="button"
        data-slot="sidebar-recent-item"
        data-state={props.selected() ? "active" : undefined}
        aria-current={props.selected() ? "page" : undefined}
        class="group flex min-h-9 w-full shrink-0 items-center gap-2 rounded-[6px] px-2 py-1 text-start hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover data-[state=active]:bg-v2-overlay-simple-overlay-pressed"
        onClick={props.onOpen}
      >
        <span class="flex size-4 shrink-0 items-center justify-center">
          <SessionTabAvatarView
            project={project()}
            directory={item().session.location.directory}
            unread={false}
          />
        </span>
        <span class="flex min-w-0 flex-1 flex-col justify-center">
          <span
            dir="auto"
            class="min-w-0 truncate text-[13px] leading-[var(--line-height-compact)] font-medium tracking-[-0.04px] text-v2-text-text-base"
          >
            {title()}
          </span>
          <span class="flex min-w-0 items-center gap-1.5 overflow-hidden text-[12px] leading-4 text-v2-text-text-faint">
            <span dir="auto" class="min-w-0 truncate">
              {displayName(project() ?? { worktree: item().session.location.directory })}
            </span>
            <Show when={props.serverTag()}>
              {(tag) => (
                <span class="max-w-24 shrink-0 truncate rounded-[3px] bg-v2-background-bg-layer-02 px-1 text-[11px] leading-4 text-v2-text-text-muted">
                  {tag()}
                </span>
              )}
            </Show>
          </span>
        </span>
        <span class="flex shrink-0 items-center gap-1.5 text-[12px] leading-4 tabular-nums text-v2-text-text-faint">
          <Show when={status.loading()}>
            <ActivityRing width={14} height={14} class="shrink-0" />
          </Show>
          <Show when={!status.loading() && status.unread() && !props.selected()}>
            <span class="size-1.5 rounded-full bg-v2-text-text-base" aria-hidden="true" />
          </Show>
          <span class="whitespace-nowrap">{age()}</span>
        </span>
      </Menu.Context.Trigger>
      <Menu.Context.Portal>
        <Menu.Context.Content
          onCloseAutoFocus={(event) => {
            if (dialog.active) event.preventDefault()
          }}
        >
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
          <Menu.Item onSelect={props.onRename}>{language.t("common.rename")}</Menu.Item>
          <Menu.Item onSelect={props.onArchive}>{language.t("common.archive")}</Menu.Item>
          <Menu.Separator />
          <Menu.Item onSelect={props.onDelete}>{language.t("common.delete")}…</Menu.Item>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
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
