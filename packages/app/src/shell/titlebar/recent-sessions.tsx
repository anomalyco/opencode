import { isSessionNotFoundError, type SessionInfo } from "@opencode/client/promise"
import { Accessibility, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { Key } from "@solid-primitives/keyed"
import { ActivityRing } from "@opencode/ui/activity-ring"
import { Button } from "@opencode/ui/button"
import { useDialog, useDialogLayer } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { Menu } from "@opencode/ui/menu"
import { displayName } from "@opencode/ui/project-avatar"
import { TextInput } from "@opencode/ui/text-input"
import { Schema } from "effect"
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
  startTransition,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import { arrayMove } from "@/runtime/array-move"
import { useLanguage } from "@/runtime/i18n/language"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal, type ServerCtx } from "@/runtime/server/runtime"
import { createSessionRenamer } from "@/session/commands/rename-session"
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
import { sessionLabel } from "@/session/title"
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
  mergeFirstPage,
  mergeRecentSessions,
  mergeSessionSearch,
  partitionRecentSessions,
  recentSessionKey,
  removePin,
  reorderPins,
  sortRecentSessions,
  splitRecentSessionKey,
  type RecentSession,
} from "./recent-sessions-model"
import { notifySessionTabsRemoved } from "./session-events"
import { sessionTabTitle } from "./tab-title"

// Root sessions fetched per server page.
const PAGE_LIMIT = 50

// The search field waits this long after the last keystroke before asking servers.
const SEARCH_DEBOUNCE_MS = 250

const RecentSidebarState = Persistence.struct({
  // Ordered `${server}\u0000${sessionID}` keys. Local to this desktop.
  pins: Persistence.array(Schema.String),
})

type PageState = {
  sessions: SessionInfo[]
  cursor: string | undefined
  loading: boolean
  loaded: boolean
  exhausted: boolean
  failed: boolean
  olderLoaded: boolean
  query: string
  generation: number
}

type Connection = { conn: ServerConnection.Any; ctx: ServerCtx; server: ServerConnection.Key }

type Hydration = { session: SessionInfo } | { missing: true }

const emptyPage = (query = ""): PageState => ({
  sessions: [],
  cursor: undefined,
  loading: false,
  loaded: false,
  exhausted: false,
  failed: false,
  olderLoaded: false,
  query,
  generation: 0,
})

function mergePage(current: SessionInfo[], next: SessionInfo[]) {
  return [...new Map([...current, ...next].map((session) => [session.id, session] as const)).values()]
}

const page = (state: Record<string, PageState>, server: string) => state[server]

/**
 * The experimental Recent sessions sidebar: pinned sessions first, then every server's newest root sessions in one
 * recency list, with server-backed search. The desktop titlebar renders it in place of the side tabs only while the
 * setting is on and available.
 */
export function RecentSessions() {
  const global = useGlobal()
  const servers = useServers()
  const language = useLanguage()
  const layout = useLayout()
  const tabs = useTabs()
  const dialog = useDialog()

  const rename = createSessionRenamer()

  const [state, setState, , ready] = persisted(Persist.global("sidebar.recent"), RecentSidebarState, { pins: [] })

  const [pages, setPages] = createStore<{ recent: Record<string, PageState>; search: Record<string, PageState> }>({
    recent: {},
    search: {},
  })

  const [hydration, setHydration] = createStore<Record<string, Hydration>>({})

  const [query, setQuery] = createSignal("")
  const [debouncedQuery, setDebouncedQuery] = createSignal("")
  const [clock, setClock] = createSignal(Date.now())

  const controllers = new Map<AbortController, { server: string; mode: "recent" | "search" }>()
  const hydrating = new Set<string>()
  const statuses = new Map<string, string>()
  let disposed = false
  let searchGeneration = 0
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  const connections = createMemo(() =>
    servers.visible.flatMap((conn): Connection[] => {
      const server = ServerConnection.key(conn)
      const ctx = global.serverCtx(server)

      return ctx ? [{ conn, ctx, server }] : []
    }),
  )

  const ctxOf = (item: RecentSession) => global.serverCtx(ServerConnection.Key.make(item.server))

  const abortServer = (server: string, mode?: "recent" | "search") => {
    controllers.forEach((owner, controller) => {
      if (owner.server !== server) return

      if (mode && owner.mode !== mode) return
      controller.abort()
    })
  }

  // A server that leaves the visible list owns no rows or hydration; its pins stay for when it returns.
  const dropServer = (server: string) => {
    abortServer(server)
    setPages("recent", produce((current) => void delete current[server]))
    setPages("search", produce((current) => void delete current[server]))
    setHydration(
      produce((current) => {
        for (const key of Object.keys(current)) {
          if (splitRecentSessionKey(key)?.server === server) delete current[key]
        }
      }),
    )
  }

  const ticker = setInterval(() => setClock(Date.now()), 60_000)
  onCleanup(() => {
    disposed = true
    clearInterval(ticker)
    clearTimeout(debounceTimer)
    controllers.forEach((_, controller) => controller.abort())
  })

  // The store is local and long-lived; drop duplicates a previous version or a manual edit left behind.
  createEffect(() => {
    if (!ready()) return

    const normalized = dedupePins(state.pins)

    if (normalized.length !== state.pins.length) setState("pins", normalized)
  })

  createEffect(
    on(
      query,
      (value) => {
        clearTimeout(debounceTimer)
        const next = value.trim()

        if (!next) {
          setDebouncedQuery("")

          return
        }

        debounceTimer = setTimeout(() => setDebouncedQuery(next), SEARCH_DEBOUNCE_MS)
      },
      { defer: true },
    ),
  )

  // Bumping the generation before the fetch effects run drops responses for a query the user has moved past.
  createEffect(
    on(
      debouncedQuery,
      () => {
        searchGeneration += 1
      },
      { defer: true },
    ),
  )

  const fetchPage = async (
    mode: "recent" | "search",
    item: Connection,
    cursor: string | undefined,
    input: { query?: string; generation?: number },
  ) => {
    if (disposed) return

    if (!connections().some((entry) => entry.server === item.server)) return

    setPages(mode, item.server, (current) => {
      const query = input.query ?? current?.query ?? ""
      const changed = !!current && query !== current.query

      return {
        ...(current ?? emptyPage()),
        sessions: changed ? [] : (current?.sessions ?? []),
        cursor: changed ? undefined : current?.cursor,
        exhausted: changed ? false : (current?.exhausted ?? false),
        olderLoaded: changed ? false : (current?.olderLoaded ?? false),
        loading: true,
        failed: false,
        query,
        generation: input.generation ?? current?.generation ?? 0,
      }
    })

    const controller = new AbortController()
    controllers.set(controller, { server: item.server, mode })

    try {
      const response = cursor
        ? await item.ctx.sdk.api.session.list({ cursor, limit: PAGE_LIMIT }, { signal: controller.signal })
        : await item.ctx.sdk.api.session.list(
            input.query
              ? { parentID: null, archived: false, order: "desc", limit: PAGE_LIMIT, search: input.query }
              : { parentID: null, archived: false, order: "desc", limit: PAGE_LIMIT },
            { signal: controller.signal },
          )

      if (controller.signal.aborted || disposed) return

      if (!connections().some((entry) => entry.server === item.server)) return

      if (input.generation !== undefined && input.generation !== searchGeneration) return

      setPages(mode, item.server, (current) => {
        const olderLoaded = current?.olderLoaded ?? false

        // Before older pages are loaded a refreshed snapshot replaces the list. Afterwards it only merges, and the
        // cursor that already advanced past page one stays where it is.
        const refreshed = !cursor && olderLoaded

        return {
          ...(current ?? emptyPage()),
          sessions: cursor
            ? mergePage(current?.sessions ?? [], response.data)
            : mergeFirstPage(current?.sessions ?? [], response.data, olderLoaded),
          cursor: refreshed ? current?.cursor : (response.cursor.next ?? undefined),
          olderLoaded: olderLoaded || cursor !== undefined,
          loading: false,
          loaded: true,
          failed: false,
          exhausted: refreshed
            ? (current?.exhausted ?? false)
            : response.data.length === 0 || !response.cursor.next,
        }
      })
    } catch {
      if (controller.signal.aborted || disposed) return

      if (!connections().some((entry) => entry.server === item.server)) return

      if (input.generation !== undefined && input.generation !== searchGeneration) return

      // Keep the cursor and exhausted state so the next scroll retries this page instead of ending pagination.
      setPages(mode, item.server, (current) => ({
        ...(current ?? emptyPage()),
        loading: false,
        loaded: true,
        failed: true,
      }))
    } finally {
      controllers.delete(controller)
    }
  }

  // First pages follow connection state: load on the first connect, refresh the snapshot on every reconnect, and
  // forget a server's pages when it leaves the visible list.
  createEffect(() => {
    const list = connections()
    const visible = new Set<string>(servers.visible.map((conn) => ServerConnection.key(conn)))

    list.forEach((item) => {
      const status = item.ctx.sdk.connection.status()
      const previous = statuses.get(item.server)

      statuses.set(item.server, status)

      if (status !== "connected") return

      const current = page(pages.recent, item.server)

      if (previous === undefined) {
        if (!current) void fetchPage("recent", item, undefined, {})

        return
      }

      if (previous === status) return

      // A reconnect starts from a fresh snapshot; drop the old first-page request so it cannot overwrite it.
      abortServer(item.server, "recent")
      void fetchPage("recent", item, undefined, {})
    })

    for (const server of [...statuses.keys()]) {
      if (visible.has(server)) continue

      statuses.delete(server)
      dropServer(server)
    }
  })

  // A new query starts one first page per connected server; continuation pages keep their original cursor.
  createEffect(() => {
    const value = debouncedQuery()

    if (!value) return

    const generation = searchGeneration

    connections().forEach((item) => {
      if (item.ctx.sdk.connection.status() !== "connected") return
      const current = page(pages.search, item.server)

      if (current?.query === value && current.generation === generation) return

      void fetchPage("search", item, undefined, { query: value, generation })
    })
  })

  const items = createMemo(() =>
    sortRecentSessions(
      connections().flatMap((item) => {
        const fetched = page(pages.recent, item.server)

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

      hydrating.add(key)
      void item.ctx.sdk.api.session
        .get({ sessionID: parsed.sessionID })
        .then(
          (response) => setHydration(key, { session: response }),
          (cause) => {
            if (!isSessionNotFoundError(cause)) return

            setHydration(key, { missing: true })
            removePinKey(key)
          },
        )
        .finally(() => hydrating.delete(key))
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
      onCleanup(item.ctx.data.on("session.unarchived", (event) => update(event.data.sessionID, undefined)))
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

  const searchQuery = () => query().trim()
  const searching = () => searchQuery().length > 0
  const normalizedQuery = () => searchQuery().toLocaleLowerCase()

  const localMatches = createMemo(() => {
    const needle = normalizedQuery()

    if (!needle) return []

    return items().filter((item) =>
      (sessionTabTitle(item.session.title, language.t("session.tab.session")) ?? "")
        .toLocaleLowerCase()
        .includes(needle),
    )
  })

  const serverMatches = createMemo(() =>
    connections().flatMap((item) => {
      const value = page(pages.search, item.server)

      if (!value || value.query !== debouncedQuery()) return []

      return mergeSessionSearch(
        item.server,
        item.ctx.data.session.apply(value.sessions),
        item.ctx.data.session.list(),
      )
    }),
  )

  // Local title matches show on the first keystroke; server matches join them when the debounce returns.
  const results = createMemo(() => {
    if (!normalizedQuery()) return []

    return sortRecentSessions([
      ...new Map([...localMatches(), ...serverMatches()].map((item) => [item.key, item] as const)).values(),
    ])
  })

  const firstPageLoading = createMemo(() => {
    if (!servers.hydrated()) return true

    // Adding a server should not blank the rows already shown while its first page loads.
    if (pinned().length > 0 || recent().length > 0) return false

    return connections().some((item) => {
      if (item.ctx.sdk.connection.status() !== "connected") return false

      const value = page(pages.recent, item.server)

      return !value?.loaded
    })
  })

  const searchPending = createMemo(() => {
    if (!searching()) return false

    if (debouncedQuery() !== searchQuery()) return true

    return connections().some((item) => {
      const value = page(pages.search, item.server)

      return !!value && value.query === searchQuery() && value.loading && !value.loaded
    })
  })

  const loadingMore = createMemo(() =>
    searching()
      ? connections().some((item) => {
          const value = page(pages.search, item.server)

          return !!value && value.query === searchQuery() && value.loading && value.loaded
        })
      : connections().some((item) => {
          const value = page(pages.recent, item.server)

          return !!value && value.loading && value.loaded
        }),
  )

  const failed = createMemo(() =>
    searching()
      ? connections().some((item) => {
          const value = page(pages.search, item.server)

          return !!value && value.query === debouncedQuery() && value.failed
        })
      : connections().some((item) => page(pages.recent, item.server)?.failed),
  )

  const retryFailed = () => {
    if (searching()) {
      const value = debouncedQuery()
      const generation = searchGeneration

      connections().forEach((item) => {
        const current = page(pages.search, item.server)

        if (!current || current.query !== value || !current.failed || current.loading) return

        if (item.ctx.sdk.connection.status() !== "connected") return

        void fetchPage("search", item, current.cursor, { query: value, generation })
      })

      return
    }

    connections().forEach((item) => {
      const current = page(pages.recent, item.server)

      if (!current?.failed || current.loading) return

      if (item.ctx.sdk.connection.status() !== "connected") return

      void fetchPage("recent", item, current.cursor, {})
    })
  }

  const empty = createMemo(() =>
    searching()
      ? results().length === 0 && !searchPending()
      : pinned().length === 0 && recent().length === 0 && !firstPageLoading(),
  )

  // Every server with a cursor loads its next page together, and the merged list re-sorts. Newly loaded rows can
  // therefore appear above rows already shown: one merged recency order is kept rather than holding rows back until
  // every server reaches the same age. An empty page or a missing next cursor ends that server's list; a failed page
  // keeps its cursor so the next scroll retries it.
  const loadMore = () => {
    if (searching()) {
      const value = searchQuery()
      const generation = searchGeneration

      connections().forEach((item) => {
        const current = page(pages.search, item.server)

        if (!current || current.query !== value || current.loading || current.exhausted) return

        if (item.ctx.sdk.connection.status() !== "connected") return

        if (current.failed) {
          void fetchPage("search", item, current.cursor, { query: value, generation })

          return
        }

        if (current.cursor === undefined) return

        void fetchPage("search", item, current.cursor, { query: value, generation })
      })

      return
    }

    connections().forEach((item) => {
      const current = page(pages.recent, item.server)

      if (!current?.loaded || current.loading || current.exhausted) return

      if (item.ctx.sdk.connection.status() !== "connected") return

      if (current.failed) {
        void fetchPage("recent", item, current.cursor, {})

        return
      }

      if (current.cursor === undefined) return

      void fetchPage("recent", item, current.cursor, {})
    })
  }

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
    if (!state.pins.includes(key)) return

    setState("pins", (current) => removePin(current, key))
  }

  // The fetched and search pages are separate caches. Archive and delete drop a row from both so it does not linger
  // when the live store never held it.
  const forget = (server: string, sessionID: string) => {
    for (const mode of ["recent", "search"] as const) {
      setPages(mode, server, (current) =>
        current ? { ...current, sessions: current.sessions.filter((session) => session.id !== sessionID) } : current,
      )
    }
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

    const directory = ctx.projects.forSession(item.session)?.worktree ?? item.session.location.directory

    void ctx.data.session.message.sync(item.session.id).catch((cause) => {
      if (isSessionNotFoundError(cause)) removePinKey(item.key)
    })
    void startTransition(() => {
      tabs.select(tabs.addSessionTab({ server: ServerConnection.Key.make(item.server), sessionId: item.session.id }))
      ctx.data.session.remember(item.session)
      ctx.projects.touch(directory)
    })
  }

  const requestFailed = (cause: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description: errorMessage(cause, language.t("common.requestFailed")),
    })

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

  const row = (item: RecentSession, index?: number) => {
    const props = {
      item,
      selected: selected(item),
      pinned: index !== undefined,
      serverTag: serverTag(item),
      now: clock,
      canMoveUp: index !== undefined && index > 0,
      canMoveDown: index !== undefined && index < pinned().length - 1,
      onOpen: () => open(item),
      onPin: () => setState("pins", (current) => addPin(current, item.key)),
      onUnpin: () => removePinKey(item.key),
      onMoveUp: () => movePin(item.key, -1),
      onMoveDown: () => movePin(item.key, 1),
      onRename: () =>
        void dialog.show(() => (
          <RenameDialog
            title={sessionLabel(item.session)}
            onRename={(title) => rename(ServerConnection.Key.make(item.server), item.session, title)}
          />
        )),
      onArchive: () => archive(item),
      onDelete: () =>
        void dialog.show(() => (
          <DeleteSessionDialog title={sessionLabel(item.session)} onConfirm={() => remove(item)} />
        )),
    }

    return index === undefined ? <RecentSessionRow {...props} /> : <PinnedSessionRow {...props} index={index} />
  }

  return (
    <div data-slot="sidebar-recent" class="flex min-h-0 flex-1 flex-col [app-region:no-drag]">
      <div class="shrink-0 px-1 pb-2">
        <TextInput
          type="search"
          class="!w-full"
          surface="invisible"
          leadingIcon={<Icon name="magnifying-glass" size="small" />}
          showClearButton
          clearIcon="circle-xmark"
          onClearClick={() => setQuery("")}
          aria-label={language.t("sidebar.recent.search")}
          placeholder={language.t("sidebar.recent.search")}
          spellcheck={false}
          autocomplete="off"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      <div
        data-scrollable
        class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-1"
        onScroll={(event) => {
          const element = event.currentTarget

          if (element.scrollTop + element.clientHeight < element.scrollHeight - 160) return

          loadMore()
        }}
      >
        <Show
          when={searching()}
          fallback={
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
                      {(item, index) => row(item(), index())}
                    </Key>
                  </DragDropProvider>
                </div>
              </Show>
              <Show when={recent().length > 0}>
                <div role="group" aria-labelledby="sidebar-recent-list" class="flex shrink-0 flex-col gap-2 pb-2.5">
                  <SectionHeader id="sidebar-recent-list" label={language.t("sidebar.recent.section.recent")} />
                  <Key each={recent()} by={(item) => item.key}>
                    {(item) => row(item())}
                  </Key>
                </div>
              </Show>
              <Show when={empty()}>
                <div class="flex items-center gap-2 px-1.5 py-2 text-[13px] leading-4 text-v2-text-text-faint">
                  <span>{language.t("sidebar.recent.empty")}</span>
                  <Show when={failed()}>
                    <Button variant="ghost-muted" size="small" onClick={retryFailed}>
                      {language.t("common.retry")}
                    </Button>
                  </Show>
                </div>
              </Show>
            </Show>
          }
        >
          <Key each={results()} by={(item) => item.key}>
            {(item) => row(item())}
          </Key>
          <Show when={empty()}>
            <div class="flex items-center gap-2 px-1.5 py-2 text-[13px] leading-4 text-v2-text-text-faint">
              <span>{language.t("sidebar.recent.noResults")}</span>
              <Show when={failed()}>
                <Button variant="ghost-muted" size="small" onClick={retryFailed}>
                  {language.t("common.retry")}
                </Button>
              </Show>
            </div>
          </Show>
        </Show>
        <Show when={loadingMore()}>
          <div class="flex justify-center p-2">
            <Loader role="img" aria-hidden="false" aria-label={language.t("common.loading")} />
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
  item: RecentSession
  selected: boolean
  pinned: boolean
  serverTag: string | undefined
  now: () => number
  canMoveUp: boolean
  canMoveDown: boolean
  onOpen: () => void
  onPin: () => void
  onUnpin: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRename: () => void
  onArchive: () => void
  onDelete: () => void
}

function PinnedSessionRow(props: RecentSessionRowProps & { index: number }) {
  const sortable = useSortable({
    get id() {
      return props.item.key
    },
    get index() {
      return props.index
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

  const ctx = () => global.serverCtx(ServerConnection.Key.make(props.item.server))
  const project = () => ctx()?.projects.forSession(props.item.session)

  const status = useSessionTabAvatarState(
    () => ServerConnection.Key.make(props.item.server),
    () => props.item.session.id,
    () => true,
    () => props.item.session,
  )

  const title = () => sessionTabTitle(props.item.session.title, language.t("session.tab.session"))

  const age = () =>
    getRelativeTime(
      new Date(props.item.session.time.updated ?? props.item.session.time.created).toISOString(),
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
        data-state={props.selected ? "active" : undefined}
        aria-current={props.selected ? "page" : undefined}
        class="group flex min-h-9 w-full shrink-0 items-center gap-2 rounded-[6px] px-2 py-1 text-start hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover data-[state=active]:bg-v2-overlay-simple-overlay-pressed"
        onClick={props.onOpen}
      >
        <span class="flex size-4 shrink-0 items-center justify-center">
          <SessionTabAvatarView
            project={project()}
            directory={props.item.session.location.directory}
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
              {displayName(project() ?? { worktree: props.item.session.location.directory })}
            </span>
            <Show when={props.serverTag}>
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
          <Show when={!status.loading() && status.unread() && !props.selected}>
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
            <Menu.Item disabled={!props.canMoveUp} onSelect={props.onMoveUp}>
              {language.t("sidebar.recent.moveUp")}
            </Menu.Item>
            <Menu.Item disabled={!props.canMoveDown} onSelect={props.onMoveDown}>
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
