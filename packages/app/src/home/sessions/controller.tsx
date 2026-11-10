import type { SessionInfo } from "@opencode/client/promise"
import { useDialog } from "@opencode/ui/context/dialog"
import { Button } from "@opencode/ui/button"
import { DialogFooter, DialogHeader, DialogTitleGroup, Dialog } from "@opencode/ui/dialog"
import { prefersReducedMotion } from "@opencode/ui/motion"
import { hashKey, onlineManager, useQueryClient } from "@tanstack/solid-query"
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  startTransition,
  untrack,
} from "solid-js"
import { notifySessionTabsRemoved } from "@/shell/titlebar/session-events"
import { useCommand } from "@/shell/commands/command"
import {
  HOME_SESSION_INDEX_LIMIT,
  HOME_SESSION_LIMIT,
  mergeHomeSessionIndex,
  retainHomeSessions,
} from "@/home/sessions/index"
import type { LocalProject } from "@/shell/state/layout"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { sessionHasOpenTab, useTabs } from "@/shell/tabs/tabs"
import { errorMessage } from "@/shell/layout/helpers"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
import { pathKey } from "@/workspaces/path-key"
import { createSessionExporter } from "@/session/commands/export-session"
import {
  createSessionDeleteState,
  selectSessionDeleteView,
  SESSION_DELETE_TIMEOUT_MS,
  transitionSessionDelete,
  type SessionDeleteEffect,
  type SessionDeleteEvent,
} from "@/session/delete-machine"
import { usePlatform } from "@/runtime/platform/platform"
import { sessionLabel, sessionTitle } from "@/session/title"
import { showToast } from "@/shell/notifications/toast"
import { archiveHomeSession } from "./archive"
import { homeSessionsQuery } from "./queries"
import {
  HOME_SESSIONS_STALE_MS,
  INITIAL_HOME_SESSIONS_LOAD_STATE,
  selectHomeSessionsListView,
  selectHomeSessionsSearchLoading,
  transitionHomeSessionsLoad,
  type HomeSessionsLoadEffect,
  type HomeSessionsLoadEvent,
  type HomeSessionsTarget,
  type HomeSessionsTimer,
} from "./load-machine"
import type { HomeController } from "../model"
import { buildHomeSessionRecords, homeProjectForSession, homeSessionLocation, type HomeSessionRecord } from "./records"

export type { HomeSessionRecord } from "./records"

export type HomeSessionGroup = {
  id: "today" | "yesterday" | "older"
  title: string
  sessions: HomeSessionRecord[]
}

export type OpenSessionOptions = { background?: boolean }

export function createHomeSessionsController(home: HomeController) {
  const tabs = useTabs()
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const queryClient = useQueryClient()
  const global = useGlobal()

  const projectDirectories = createMemo(() => {
    const selected = home.selection.value().directory

    if (!selected) return
    const project = home.project.selected()

    return project ? directories(project) : [selected]
  })

  const [load, setLoad] = createSignal(INITIAL_HOME_SESSIONS_LOAD_STATE)
  // Bumped when the shared index cache changes, so lists written by the sidebar, a rename or a delete show here.
  const [cacheVersion, setCacheVersion] = createSignal(0)
  const loadTimers: Partial<Record<HomeSessionsTimer, ReturnType<typeof setTimeout>>> = {}

  // Only a change of server or of its connection retargets the list. The cache is keyed by the connection itself.
  const focus = createMemo(
    () => {
      const conn = home.server.focused()

      if (!conn) return
      const key = ServerConnection.key(conn)

      return { conn, key, connection: homeSessionsConnection(conn, key) }
    },
    undefined,
    { equals: (a, b) => a?.conn === b?.conn && a?.connection === b?.connection },
  )

  function homeSessionsConnection(
    conn: ServerConnection.Any,
    key: ServerConnection.Key,
  ): HomeSessionsTarget["connection"] {
    if (home.server.focusedContext()?.sdk.connection.status() === "connected") return "connected"
    const health = home.server.health(conn)

    if (global.serverSignedOut(key) || health?.type === "unauthorized" || health?.type === "auth") return "auth"

    if (health?.type === "incompatible") return "incompatible"

    if (health?.type === "unreachable" || health?.type === "stopped") return "offline"

    return "connecting"
  }

  function homeSessionsTarget(current = focus()): HomeSessionsTarget | undefined {
    if (!current) return
    const cache = queryClient.getQueryState<SessionInfo[]>(["home-sessions", current.conn])
    const cached = cache?.data !== undefined

    return {
      server: current.key,
      connection: current.connection,
      cached,
      stale: !cached || cache.isInvalidated || Date.now() - cache.dataUpdatedAt >= HOME_SESSIONS_STALE_MS,
    }
  }

  // Effects run untracked: a dispatch from an effect must not subscribe it to the machine or the server list.
  const dispatchLoad = (event: HomeSessionsLoadEvent) =>
    untrack(() => {
      const previous = load()
      const next = transitionHomeSessionsLoad(previous, event)

      if (next.state !== previous) setLoad(next.state)
      next.effects.forEach(runLoadEffect)
    })

  function runLoadEffect(effect: HomeSessionsLoadEffect) {
    if (effect.type === "timer.start") {
      clearTimeout(loadTimers[effect.timer])
      loadTimers[effect.timer] = setTimeout(() => dispatchLoad(effect.event), effect.delayMs)

      return
    }

    if (effect.type === "timer.stop") {
      clearTimeout(loadTimers[effect.timer])
      loadTimers[effect.timer] = undefined

      return
    }

    // A probe that finds the server still away leaves the connection unchanged, so report the target again.
    if (effect.type === "probe.servers") {
      void global.servers.retry().then(() => dispatchLoad({ type: "context.changed", target: homeSessionsTarget() }))

      return
    }

    const conn = home.server.list().find((item) => ServerConnection.key(item) === effect.server)

    if (effect.type === "fetch.cancel") {
      if (conn) void queryClient.cancelQueries({ queryKey: ["home-sessions", conn], exact: true })

      return
    }

    const attempt = effect.attempt
    const ctx = conn ? home.server.context(conn) : undefined

    if (!conn || !ctx) {
      dispatchLoad({ type: "fetch.failed", attempt, message: language.t("common.requestFailed") })

      return
    }

    // Through the shared query, so a fetch the sidebar already started is joined and the result lands in its cache.
    void queryClient.fetchQuery({ ...homeSessionsQuery(conn, ctx), staleTime: 0 }).then(
      () => dispatchLoad({ type: "fetch.succeeded", attempt, reducedMotion: prefersReducedMotion() }),
      (cause) =>
        dispatchLoad({
          type: "fetch.failed",
          attempt,
          message: errorMessage(cause, language.t("common.requestFailed")),
        }),
    )
  }

  createEffect(() => {
    const current = focus()
    untrack(() => dispatchLoad({ type: "context.changed", target: homeSessionsTarget(current) }))
  })

  // The query refetched on invalidation and on reconnect while stale; the machine keeps both.
  onCleanup(
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.query.queryKey[0] !== "home-sessions") return
      setCacheVersion((version) => version + 1)

      if (event.action.type !== "invalidate") return
      const current = untrack(focus)

      if (current?.connection !== "connected" || event.query.queryHash !== hashKey(["home-sessions", current.conn]))
        return
      dispatchLoad({ type: "refresh", server: current.key })
    }),
  )
  onCleanup(
    onlineManager.subscribe((online) => {
      const target = untrack(homeSessionsTarget)

      if (!online || target?.connection !== "connected" || !target.stale) return
      dispatchLoad({ type: "refresh", server: target.server })
    }),
  )
  onCleanup(() => dispatchLoad({ type: "disposed" }))

  const fetchedSessions = createMemo(() => {
    // The machine settles after the cache write it reports, so a new phase always reads the new list.
    cacheVersion()
    load()
    const conn = home.server.focused()

    return (conn && queryClient.getQueryData<SessionInfo[]>(["home-sessions", conn])) || []
  })

  // The shared index holds one bounded page of the newest sessions. A project scoped to older history asks the server
  // for that directory's newest sessions directly, so selecting a quiet project still lists its sessions.
  const [scopedSessions, setScopedSessions] = createSignal<SessionInfo[]>([])
  let scopedKey: string | undefined

  createEffect(() => {
    const directories = projectDirectories()
    const conn = home.server.focused()
    const ctx = home.server.focusedContext()

    if (!directories || !conn || !ctx) {
      scopedKey = undefined
      setScopedSessions([])

      return
    }

    const key = `${ServerConnection.key(conn)}\0${directories.map(pathKey).join("\0")}`

    if (key === scopedKey) return
    scopedKey = key
    const controller = new AbortController()
    setScopedSessions([])
    void Promise.allSettled(
      directories.map((directory) =>
        ctx.sdk.api.session.list(
          { directory, limit: HOME_SESSION_INDEX_LIMIT, order: "desc", parentID: null },
          { signal: controller.signal },
        ),
      ),
    ).then((results) => {
      if (controller.signal.aborted) return
      setScopedSessions(results.flatMap((result) => (result.status === "fulfilled" ? result.value.data : [])))
    })
    onCleanup(() => controller.abort())
  })

  const indexedSessions = createMemo(() => {
    const ctx = home.server.focusedContext()
    const conn = home.server.focused()

    if (!ctx || !conn) return []

    return retainHomeSessions(
      ctx.data.session.apply(
        mergeHomeSessionIndex([...fetchedSessions(), ...scopedSessions()], ctx.data.session.list()),
      ),
      HOME_SESSION_LIMIT,
      Date.now(),
    )
  })

  const allRecords = createMemo(() =>
    buildHomeSessionRecords({
      sessions: indexedSessions,
      projectDirectories,
      projects: home.project.list,
      resolveProject: (session) => home.server.focusedContext()?.projects.forSession(session),
    }),
  )

  const records = createMemo(() => allRecords().slice(0, HOME_SESSION_LIMIT))
  const groups = createMemo(() => groupSessions(records(), language))
  const prefetched = new Set<string>()

  const location = (record: HomeSessionRecord) => {
    const branch = home.server.focusedContext()?.data.location.vcs.info(record.session.location)?.branch.current

    return homeSessionLocation(record.session.location.directory, branch)
  }

  const syncLocations = (record?: HomeSessionRecord) => {
    if (platform.platform !== "desktop") return
    const ctx = home.server.focusedContext()

    if (!ctx) return

    if (record) {
      if (!ctx.data.location.info(record.session.location)) return
      void ctx.data.location.vcs.sync(record.session.location).catch(() => undefined)

      return
    }

    const locations = new Map(
      records()
        .filter((record) => !!ctx.data.location.info(record.session.location))
        .map((record) => [pathKey(record.session.location.directory), record.session.location] as const),
    )

    void Promise.allSettled(Array.from(locations.values(), (location) => ctx.data.location.vcs.sync(location)))
  }

  createEffect(() => {
    const ctx = home.server.focusedContext()
    const conn = home.server.focused()

    if (!ctx || !conn) return
    records()
      .slice(0, 2)
      .forEach((record) => {
        const key = `${ServerConnection.key(conn)}\0${record.session.id}`

        if (prefetched.has(key)) return
        prefetched.add(key)
        void untrack(() => ctx.data.session.sync(record.session.id)).catch(() => {})
      })
  })

  command.register("palette", () => [
    {
      id: "command.palette",
      title: language.t("command.palette"),
      hidden: true,
      onSelect: async () => {
        const conn = home.server.focused()

        if (!conn) return
        const ctx = home.server.focusedContext()

        if (!ctx) return
        const { HomeCommandPalette } = await import("../start/command-palette")
        void dialog.show(() => (
          <HomeCommandPalette
            server={conn}
            onSelectSession={(entry) => {
              if (!entry.sessionID || !entry.directory || !entry.server) return
              const sessionID = entry.sessionID
              const server = entry.server
              const directory = entry.project?.worktree ?? entry.directory
              ctx.projects.touch(directory)
              void startTransition(() => {
                const tab = tabs.addSessionTab({ server, sessionId: sessionID })
                tabs.select(tab)
              })
            }}
          />
        ))
      },
    },
  ])

  // A save the caller cancelled still updates the list if the server took it.
  const rename = async (server: ServerConnection.Key, session: SessionInfo, title: string, signal?: AbortSignal) => {
    const conn = home.server.list().find((item) => ServerConnection.key(item) === server)
    const ctx = conn ? home.server.context(conn) : undefined

    if (!conn || !ctx) return false
    const next = title.trim()

    if (!next || next === sessionLabel(session)) return true

    return ctx.sdk.api.session
      .update({ sessionID: session.id, title: next }, { signal })
      .then(() => {
        ctx.data.session.remember({ ...(ctx.data.session.get(session.id) ?? session), title: next })
        // Rename advances time.updated server-side, but the data layer's rename guard keeps the session where it was.
        queryClient.setQueryData<SessionInfo[]>(["home-sessions", conn], (current) =>
          current?.map((item) => (item.id === session.id ? { ...item, title: next } : item)),
        )

        return true
      })
      .catch((cause) => {
        if (signal?.aborted) return false
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(cause, language.t("common.requestFailed")),
        })

        return false
      })
  }

  const exporter = createSessionExporter()

  const serverContext = (server: ServerConnection.Key) => {
    const conn = home.server.list().find((item) => ServerConnection.key(item) === server)
    const ctx = conn ? home.server.context(conn) : undefined

    return conn && ctx ? { conn, ctx } : undefined
  }

  function DeleteDialog(props: { server: ServerConnection.Key; session: SessionInfo }) {
    const name = () => sessionTitle(props.session.title) ?? language.t("command.session.new")
    const [deleteState, setDeleteState] = createSignal(createSessionDeleteState(props.session.id))
    let timer: ReturnType<typeof setTimeout> | undefined

    const dispatch = (event: SessionDeleteEvent) => {
      const next = transitionSessionDelete(untrack(deleteState), event)

      if (next.state !== untrack(deleteState)) setDeleteState(next.state)
      next.effects.forEach(run)
    }

    // Read when the user confirms, before the delete hides the session and its children from the list.
    const deleteTarget = () => {
      const ctx = serverContext(props.server)?.ctx

      return ctx ? { removedIDs: sessionTreeIDs(ctx.data.session.list(), props.session.id) } : undefined
    }

    function run(effect: SessionDeleteEffect) {
      if (effect.type === "delete.run") {
        const target = serverContext(props.server)

        if (!target) return dispatch({ type: "delete.failed", attempt: effect.attempt, cause: undefined })
        const rows = homeRowTops()
        // The data layer hides the session at once, keeps it hidden after session.deleted, and shows it again if the
        // request fails, so the cached index drops it only once the server has.
        const request = Promise.try(() => target.ctx.data.session.remove(effect.sessionID))
        animateHomeRowsUp(rows)
        void request
          .finally(() => void queryClient.invalidateQueries({ queryKey: ["home-sessions", target.conn], exact: true }))
          .then(
            () => dispatch({ type: "delete.succeeded", attempt: effect.attempt, target: effect.target }),
            (cause: unknown) => dispatch({ type: "delete.failed", attempt: effect.attempt, cause }),
          )

        return
      }

      if (effect.type === "dialog.close") return dialog.close()

      if (effect.type === "session.removed") {
        const conn = serverContext(props.server)?.conn

        if (conn)
          queryClient.setQueryData<SessionInfo[]>(["home-sessions", conn], (current) =>
            current?.filter((item) => !effect.target.removedIDs.includes(item.id)),
          )
        notifySessionTabsRemoved({
          server: props.server,
          directory: props.session.location.directory,
          sessionIDs: [...effect.target.removedIDs],
        })

        return
      }

      if (effect.type === "toast.delete-failed")
        return showToast({
          title: language.t("session.delete.failed.title"),
          description:
            effect.cause === undefined
              ? undefined
              : errorMessage(effect.cause, language.t("session.delete.failed.title")),
        })

      clearTimeout(timer)
      timer = undefined

      if (effect.type === "timer.cancel") return
      timer = setTimeout(
        () => dispatch({ type: "delete.timed-out", attempt: effect.attempt }),
        SESSION_DELETE_TIMEOUT_MS,
      )
    }

    onCleanup(() => dispatch({ type: "disposed" }))
    const busy = () => selectSessionDeleteView(deleteState()).busy

    return (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("session.delete.title")}
            description={language.t("session.delete.confirm", { name: name() })}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" autofocus disabled={busy()} onClick={() => dispatch({ type: "cancel.requested" })}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={busy()}
            onClick={() => dispatch({ type: "confirm.requested", target: deleteTarget() })}
          >
            {language.t("session.delete.button")}
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }

  return {
    copy: {
      language,
    },
    data: {
      records,
      groups,
      listView: createMemo(() => selectHomeSessionsListView(load(), groups().length > 0)),
      loading: () => selectHomeSessionsSearchLoading(load()),
      retry: () => dispatchLoad({ type: "retry" }),
      searchRecords: allRecords,
    },
    platform: {
      desktop: platform.platform === "desktop",
    },
    location: {
      value: location,
      sync: syncLocations,
    },
    session: {
      showProjectName: () => !home.project.selected(),
      server: () => home.selection.value().server,
      canCreate: () => !!home.project.newSession(),
      lookup: async (sessionID: string, signal?: AbortSignal) => {
        const ctx = home.server.focusedContext()

        if (!ctx) return
        const result = await ctx.sdk.api.session.get({ sessionID }, { signal })

        if (result.time.archived) return

        return buildHomeSessionRecords({
          sessions: () => [result],
          projectDirectories,
          projects: home.project.list,
          resolveProject: ctx.projects.forSession,
        })[0]
      },
      create: home.project.openNewSession,
      open: (session: SessionInfo, options?: OpenSessionOptions) => {
        const project = homeProjectForSession(session, home.project.list())
        const conn = home.server.focused()

        if (!conn) return
        const connKey = ServerConnection.key(conn)
        const directory = project?.worktree ?? session.location.directory
        const ctx = home.server.focusedContext()

        if (!ctx) return

        if (!options?.background) void ctx.data.session.message.sync(session.id).catch(() => undefined)
        // Commit cache/project changes with navigation instead of rebuilding
        // the outgoing Home list before leaving it.
        void startTransition(() => {
          const tab = tabs.addSessionTab({ server: connKey, sessionId: session.id })

          if (!options?.background) tabs.select(tab)
          // Keep the canonical record's server times: the list row may carry a local send bump.
          ctx.data.session.remember(ctx.data.session.get(session.id) ?? session)

          if (!options?.background) ctx.projects.touch(directory)
        })
      },
      archive: async (session: SessionInfo) => {
        const conn = home.server.focused()
        const ctx = home.server.focusedContext()

        if (!conn || !ctx) return
        await archiveHomeSession({
          server: ServerConnection.key(conn),
          session,
          // TODO: Restore archiving when the V2 client exposes a session archive API.
          archive: async (_sessionID) => Promise.reject(new Error("Session archiving is unavailable")),
          remove() {},
          onError: (cause) =>
            showToast({
              title: language.t("common.requestFailed"),
              description: errorMessage(cause, language.t("common.requestFailed")),
            }),
        })
      },
      rename,
      export: (server: ServerConnection.Key, session: SessionInfo) =>
        exporter.export({ server, sessionID: session.id }),
      exporting: (server: ServerConnection.Key, session: SessionInfo) =>
        exporter.exporting({ server, sessionID: session.id }),
      showDelete: (server: ServerConnection.Key, session: SessionInfo) =>
        dialog.show(() => <DeleteDialog server={server} session={session} />),
    },
    tab: {
      isOpen: (record: HomeSessionRecord) => {
        const server = home.selection.value().server

        return !!server && sessionHasOpenTab(tabs.store, server, record.session)
      },
    },
  }
}

function directories(project: LocalProject) {
  return [project.worktree, ...(project.sandboxes ?? [])]
}

const HOME_ROW_SELECTOR = '[data-component="home-session-row-container"]'

function homeRowTops() {
  return new Map(
    Array.from(document.querySelectorAll<HTMLElement>(HOME_ROW_SELECTOR), (row) => {
      return [row.dataset.sessionId, row.getBoundingClientRect().top] as const
    }),
  )
}

// FLIP: rows below a removed row jump up in layout; play the difference back as a short transform.
function animateHomeRowsUp(tops: Map<string | undefined, number>) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return

  document.querySelectorAll<HTMLElement>(HOME_ROW_SELECTOR).forEach((row) => {
    const before = tops.get(row.dataset.sessionId)
    const delta = before === undefined ? 0 : before - row.getBoundingClientRect().top

    if (delta === 0) return
    row.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], {
      duration: 180,
      easing: "cubic-bezier(0.645, 0.045, 0.355, 1)",
    })
  })
}

export function homeSessionSearchKey(record: HomeSessionRecord) {
  return `${pathKey(record.session.location.directory)}:${record.session.id}`
}

// Calendar day in the local time zone, comparable as a number.
function localDay(date: Date) {
  return date.getFullYear() * 10_000 + date.getMonth() * 100 + date.getDate()
}

function groupSessions(records: HomeSessionRecord[], language: ReturnType<typeof useLanguage>): HomeSessionGroup[] {
  const now = new Date()
  const today = localDay(now)
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))

  const day = (record: HomeSessionRecord) =>
    localDay(new Date(record.session.time.updated ?? record.session.time.created))

  const todaySessions = records.filter((record) => day(record) === today)
  const yesterdaySessions = records.filter((record) => day(record) === yesterday)
  const olderSessions = records.filter((record) => day(record) !== today && day(record) !== yesterday)

  const olderTitle =
    todaySessions.length === 0 && yesterdaySessions.length === 0
      ? language.t("sidebar.project.recentSessions")
      : language.t("home.sessions.group.older")

  return [
    { id: "today" as const, title: language.t("home.sessions.group.today"), sessions: todaySessions },
    { id: "yesterday" as const, title: language.t("home.sessions.group.yesterday"), sessions: yesterdaySessions },
    { id: "older" as const, title: olderTitle, sessions: olderSessions },
  ].filter((group) => group.sessions.length > 0)
}

export type HomeSessionsController = ReturnType<typeof createHomeSessionsController>

export function HomeSessionStatusController(props: {
  server: ServerConnection.Key
  record: HomeSessionRecord
  isOpenTab: (record: HomeSessionRecord) => boolean
  render: (state: { unread: Accessor<boolean>; loading: Accessor<boolean>; open: Accessor<boolean> }) => JSX.Element
}) {
  const avatar = useSessionTabAvatarState(
    () => props.server,
    () => props.record.session.id,
    () => true,
    // Home rows can come from the fetched index before the session is loaded.
    () => props.record.session,
  )

  return props.render({
    unread: avatar.unread,
    loading: avatar.loading,
    open: () => props.isOpenTab(props.record),
  })
}
