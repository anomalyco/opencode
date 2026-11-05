import { isSessionNotFoundError, type SessionInfo } from "@opencode/client/promise"
import { useQueries, useQueryClient } from "@tanstack/solid-query"
import { createStore } from "solid-js/store"
import { createComputed, createEffect, createMemo, createSignal, onCleanup, startTransition, untrack } from "solid-js"
import { useGlobal, type ServerCtx } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { canUseServer } from "@/runtime/server/health-machine"
import { useLanguage } from "@/runtime/i18n/language"
import { projectSettingsKey, useSettings } from "@/settings/model"
import { useLayout } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { sessionBusy, sessionRequests, type SessionRequests } from "@/shell/layout/project-avatar-state"
import { pathKey } from "@/workspaces/path-key"
import { parseHomeSessionIndex } from "@/home/sessions/index"
import { sessionFormRequest, sessionPermissionRequest, sessionTreeIDs } from "@/session/requests/session-request-tree"
import { notifySessionTabsRemoved } from "./session-events"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { workingSince } from "./inbox-working"
import {
  INITIAL_INBOX_BRANCH_STATE,
  selectBranchLoading,
  transitionInboxBranch,
  type InboxBranchEffect,
  type InboxBranchEvent,
} from "./inbox-branch-machine"
import {
  INITIAL_INBOX_SETTLE_STATE,
  selectInboxLoading,
  transitionInboxSettle,
  type InboxSettleEffect,
  type InboxSettleEvent,
} from "./inbox-settle-machine"

// Keep the immutable result opaque so Solid Query does not recursively unwrap every session.
const selectSessions = (sessions: SessionInfo[]) => () => sessions

// Root sessions fetched per server.
const INDEX_LIMIT = 50

// The index excludes archived sessions, so a view that lists them loads the newest archived ones separately.
const ARCHIVED_LIMIT = 50

export type InboxStatus = "approval" | "input" | "working" | "failed" | "done" | "ready"

export type InboxEntry = {
  key: string
  conn: ServerConnection.Any
  server: ServerConnection.Key
  ctx: ServerCtx
  session: SessionInfo
  status: InboxStatus
  since: number | undefined
}

/**
 * Root sessions across every visible server with the state a person acts on: waiting for an answer, working,
 * finished and unread, or read. Home and the experimental Inbox sidebar list them; only the sidebar loads archived
 * sessions.
 */
export function createSessionInbox(options: { archived?: boolean } = {}) {
  const global = useGlobal()
  const servers = useServers()
  const settings = useSettings()
  const layout = useLayout()
  const tabs = useTabs()
  const language = useLanguage()
  const queryClient = useQueryClient()

  const [clock, setClock] = createStore({ second: Date.now(), minute: Date.now() })
  const timer = setInterval(() => setClock("minute", Date.now()), 60_000)
  onCleanup(() => clearInterval(timer))

  const [requestTimes, setRequestTimes] = createStore<Record<string, number | undefined>>({})

  // A server that rejects our credentials has no controller, so it lists nothing until it signs in again.
  const connections = createMemo(() =>
    servers.visible.flatMap((conn) => {
      const ctx = global.serverCtx(ServerConnection.key(conn))

      return ctx ? [{ conn, ctx }] : []
    }),
  )

  // The inbox stays mounted and rarely refetches the index, so drop sessions the server no longer has.
  const forget = (conn: ServerConnection.Any, sessionID: string) => {
    queryClient.setQueryData<SessionInfo[]>(["inbox-sessions", conn], (current) =>
      current?.filter((session) => session.id !== sessionID),
    )
    queryClient.setQueryData<SessionInfo[]>(["inbox-archived-sessions", conn], (current) =>
      current?.filter((session) => session.id !== sessionID),
    )
  }

  createEffect(() => {
    connections().forEach((item) => {
      onCleanup(item.ctx.data.on("session.deleted", (event) => forget(item.conn, event.data.sessionID)))
      const server = ServerConnection.key(item.conn)

      // Request snapshots have no timestamp; live events let newly waiting rows show their actual waiting age.
      onCleanup(
        item.ctx.data.on("permission.asked", (event) => setRequestTimes(`${server}\0${event.data.id}`, event.created)),
      )
      onCleanup(
        item.ctx.data.on("form.created", (event) => setRequestTimes(`${server}\0${event.data.form.id}`, event.created)),
      )
      onCleanup(
        item.ctx.data.on("permission.replied", (event) =>
          setRequestTimes(`${server}\0${event.data.requestID}`, undefined),
        ),
      )
      onCleanup(item.ctx.data.on("form.replied", (event) => setRequestTimes(`${server}\0${event.data.id}`, undefined)))
      onCleanup(
        item.ctx.data.on("form.cancelled", (event) => setRequestTimes(`${server}\0${event.data.id}`, undefined)),
      )
    })
  })

  // Keep this cache separate from Home's paginated index so changing interface modes cannot reuse a partial index.
  // One page of the newest root sessions: what needs a person is recent, and paging the whole history first made the
  // first paint wait on every session the server has.
  const queries = useQueries(() => ({
    queries: connections().map((item) => ({
      queryKey: ["inbox-sessions", item.conn] as const,
      enabled: item.ctx.sdk.connection.status() === "connected",
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        item.ctx.sdk.api.session
          .list({ limit: INDEX_LIMIT, order: "desc", parentID: null }, { signal })
          .then((response) => parseHomeSessionIndex(response.data)),
      retry: false,
      staleTime: 30_000,
      refetchOnMount: true,
      refetchOnReconnect: true,
      select: selectSessions,
    })),
  }))

  const archivedQueries = useQueries(() => ({
    queries: connections().map((item) => ({
      queryKey: ["inbox-archived-sessions", item.conn] as const,
      enabled: !!options.archived && item.ctx.sdk.connection.status() === "connected",
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        item.ctx.sdk.api.session
          .list({ limit: ARCHIVED_LIMIT, order: "desc", parentID: null, archived: true }, { signal })
          .then((response) => response.data),
      retry: false,
      staleTime: 30_000,
      refetchOnMount: true,
      refetchOnReconnect: true,
      select: selectSessions,
    })),
  }))

  const entries = createMemo(() =>
    connections()
      .flatMap((item, index) => {
        const data = item.ctx.data
        const notification = item.ctx.notification.session
        const server = ServerConnection.key(item.conn)

        // A root session counts as working while any session in its family is busy.
        const busyRoots = new Set(
          [...data.session.list().map((session) => session.id), ...data.session.active()].flatMap((id) =>
            sessionBusy(data, id) ? [data.session.root(id)] : [],
          ),
        )

        const status = (session: SessionInfo, requests: SessionRequests): InboxStatus => {
          if (requests.permission) return "approval"

          if (requests.form) return "input"

          if (busyRoots.has(session.id)) return "working"

          if (!notification.unread(session.id, session)) return "ready"

          return session.outcome === "failed" ? "failed" : "done"
        }

        // A waiting session ages from the request it shows, not from one auto-approve still answers.
        const since = (value: InboxStatus, session: SessionInfo, requests: SessionRequests) => {
          if (value === "working") return workingSince(session)

          if (!inboxBusy(value)) return session.time.idle ?? session.time.updated

          const request = value === "approval" ? requests.permission : requests.form

          return (request && requestTimes[`${server}\0${request.id}`]) ?? workingSince(session) ?? session.time.updated
        }

        // Locally known sessions come last so live archive and unarchive events win over cached indexes.
        const sessions = new Map(
          [
            ...(queries[index]?.data?.() ?? []),
            ...(options.archived ? (archivedQueries[index]?.data?.() ?? []) : []),
            ...data.session.list(),
          ].map((session) => [session.id, session] as const),
        )

        return data.session
          .apply([...sessions.values()].filter((session) => !session.parentID))
          .map((session): InboxEntry => {
            const project = projectSettingsKey(item.ctx.sdk.scope, session.projectID)
            const requests = sessionRequests(item.ctx, session.id, true, settings.permissions.autoApproves(project))
            const value = status(session, requests)

            return {
              key: `${server}\0${session.id}`,
              conn: item.conn,
              server,
              ctx: item.ctx,
              session,
              status: value,
              since: since(value, session, requests),
            }
          })
      })
      .toSorted((a, b) => b.session.time.updated - a.session.time.updated),
  )

  const hasWorking = createMemo(() => entries().some((entry) => entry.status === "working"))

  createEffect(() => {
    if (!hasWorking()) return
    setClock("second", Date.now())
    const interval = setInterval(() => setClock("second", Date.now()), 1_000)

    onCleanup(() => clearInterval(interval))
  })

  // Rows are keyed by stable strings so live session updates do not remount them.
  const byKey = createMemo(() => new Map(entries().map((entry) => [entry.key, entry])))

  // The index can arrive before the active-session snapshot. Check unfinished runs too so pending requests
  // settle before the first paint.
  const [settleState, setSettleState] = createSignal(INITIAL_INBOX_SETTLE_STATE)
  let revealTimer: ReturnType<typeof setTimeout> | undefined

  const dispatchSettle = (event: InboxSettleEvent) =>
    untrack(() => {
      const previous = settleState()
      const next = transitionInboxSettle(previous, event)

      if (next.state !== previous) setSettleState(next.state)
      next.effects.forEach(runSettleEffect)
    })

  const runSettleEffect = (effect: InboxSettleEffect) => {
    if (effect.type === "reveal-timer.clear") {
      clearTimeout(revealTimer)
      revealTimer = undefined

      return
    }

    if (effect.type === "reveal-timer.start") {
      clearTimeout(revealTimer)
      revealTimer = setTimeout(() => {
        revealTimer = undefined
        dispatchSettle({ type: "reveal.timed-out" })
      }, effect.timeoutMs)

      return
    }
    const entry = byKey().get(effect.key)

    void Promise.allSettled(
      entry
        ? [
            Promise.try(() => entry.ctx.data.session.permission.sync(entry.session.id)),
            Promise.try(() => entry.ctx.data.session.form.sync(entry.session.id)),
          ]
        : [],
    ).then(() => dispatchSettle({ type: "requests.settled", key: effect.key }))
  }

  // Synchronous, so a warm cache settles before the first paint without flashing the loader. A server that never
  // connects or fails its health check does not hold the screen, and the machine's reveal timer bounds one that stalls.
  createComputed(() =>
    dispatchSettle({
      type: "sync",
      hydrated: servers.hydrated(),
      serversSettled: connections().every((item, index) => {
        if (!canUseServer(global.servers.health[ServerConnection.key(item.conn)])) return true

        return !!queries[index]?.isSuccess || !!queries[index]?.isError
      }),
      workingKeys: entries().flatMap((entry) =>
        entry.status === "working" || workingSince(entry.session) !== undefined ? [entry.key] : [],
      ),
    }),
  )

  onCleanup(() => dispatchSettle({ type: "disposed" }))

  const selected = (entry: InboxEntry) => {
    const route = layout.route()

    if (route.type !== "session" || route.server !== entry.server) return false

    return route.sessionId === entry.session.id || entry.ctx.data.session.root(route.sessionId) === entry.session.id
  }

  // Git info is not stored on the session, so load it for the rows a view shows. `branchTargets` keeps the latest row
  // per location for the lookup; the machine owns each location's phase.
  const [branchState, setBranchState] = createSignal(INITIAL_INBOX_BRANCH_STATE)
  const branchTargets = new Map<string, InboxEntry>()
  const branchTimers = new Map<number, ReturnType<typeof setTimeout>>()

  const dispatchBranch = (event: InboxBranchEvent) =>
    untrack(() => {
      const previous = branchState()
      const next = transitionInboxBranch(previous, event)

      if (next.state !== previous) setBranchState(next.state)
      next.effects.forEach(runBranchEffect)
    })

  const runBranchEffect = (effect: InboxBranchEffect) => {
    if (effect.type === "timers.clear") {
      branchTimers.forEach(clearTimeout)
      branchTimers.clear()
      branchTargets.clear()

      return
    }

    if (effect.type === "timer.clear") {
      clearTimeout(branchTimers.get(effect.attempt))
      branchTimers.delete(effect.attempt)

      return
    }

    if (effect.type === "retry.schedule") {
      branchTimers.set(
        effect.attempt,
        setTimeout(() => {
          branchTimers.delete(effect.attempt)
          dispatchBranch({ type: "retry.due", key: effect.key, attempt: effect.attempt })
        }, effect.delayMs),
      )

      return
    }

    branchTimers.set(
      effect.attempt,
      setTimeout(() => {
        branchTimers.delete(effect.attempt)
        dispatchBranch({ type: "load.timed-out", key: effect.key, attempt: effect.attempt })
      }, effect.timeoutMs),
    )
    // A synchronous throw rejects too, so every attempt settles into an event.
    void Promise.try(() => {
      const entry = branchTargets.get(effect.key)

      if (!entry) throw new Error(`No inbox row for location ${effect.key}`)
      const location = entry.ctx.data.location

      return (
        location.info(entry.session.location) ? Promise.resolve() : location.syncInfo(entry.session.location)
      ).then(() => location.vcs.sync(entry.session.location))
    }).then(
      () => dispatchBranch({ type: "load.succeeded", key: effect.key, attempt: effect.attempt }),
      () => dispatchBranch({ type: "load.failed", key: effect.key, attempt: effect.attempt }),
    )
  }

  createEffect(() =>
    dispatchBranch({
      type: "connections.changed",
      connected: connections().flatMap((item) =>
        item.ctx.sdk.connection.status() === "connected" ? [ServerConnection.key(item.conn)] : [],
      ),
    }),
  )

  onCleanup(() => dispatchBranch({ type: "disposed" }))

  const loadBranches = (list: InboxEntry[]) => {
    list.forEach((entry) => branchTargets.set(locationKey(entry), entry))
    dispatchBranch({
      type: "enqueue",
      targets: list.map((entry) => ({ key: locationKey(entry), server: entry.server })),
    })
  }

  const open = (entry: InboxEntry) => {
    const directory = entry.ctx.projects.forSession(entry.session)?.worktree ?? entry.session.location.directory
    void entry.ctx.data.session.message.sync(entry.session.id).catch((error) => {
      if (isSessionNotFoundError(error)) forget(entry.conn, entry.session.id)
    })
    void startTransition(() => {
      tabs.select(tabs.addSessionTab({ server: entry.server, sessionId: entry.session.id }))
      entry.ctx.data.session.remember(entry.session)
      entry.ctx.projects.touch(directory)
    })
  }

  const requestFailed = (cause: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description: errorMessage(cause, language.t("common.requestFailed")),
    })

  // Move the session between the cached indexes so it changes section before either refetches.
  const move = (entry: InboxEntry, archivedAt: number | undefined) => {
    const session = { ...entry.session, time: { ...entry.session.time, archived: archivedAt } }

    forget(entry.conn, entry.session.id)
    queryClient.setQueryData<SessionInfo[]>(
      [archivedAt === undefined ? "inbox-sessions" : "inbox-archived-sessions", entry.conn],
      (current) => current && [session, ...current],
    )
  }

  // The pending request anywhere in the session's family, for views that answer it inline.
  const family = (entry: InboxEntry) =>
    [...new Set([entry.session.id, ...entry.ctx.data.session.family(entry.session.id)])].flatMap((id) => {
      const info = entry.ctx.data.session.get(id)

      return info ? [info] : []
    })

  return {
    now: (status: InboxStatus) => (status === "working" ? clock.second : clock.minute),
    entries,
    /** The first load has not settled: lists would still move or claim nothing needs you. */
    loading: () => selectInboxLoading(settleState()),
    byKey,
    selected,
    open,
    loadBranches,
    branchLoading: (entry: InboxEntry) =>
      !entry.ctx.data.location.vcs.info(entry.session.location) &&
      selectBranchLoading(branchState(), locationKey(entry)),
    branch: (entry: InboxEntry) =>
      entry.ctx.data.location.vcs.info(entry.session.location)?.branch.current ?? undefined,
    inWorktree: inboxInWorktree,
    permission: (entry: InboxEntry) =>
      sessionPermissionRequest(family(entry), entry.ctx.data.session.permission.list, entry.session.id),
    form: (entry: InboxEntry) => sessionFormRequest(family(entry), entry.ctx.data.session.form.list, entry.session.id),
    decide: (entry: InboxEntry, decision: "once" | "always" | "reject") => {
      const request = sessionPermissionRequest(family(entry), entry.ctx.data.session.permission.list, entry.session.id)

      if (!request) return
      // The data store's reply drops the request at once, so the row leaves Needs you without waiting for an event.
      void entry.ctx.data.session.permission
        .reply({ sessionID: request.sessionID, requestID: request.id, decision })
        .catch(requestFailed)
    },
    // Marking viewed reads the loaded session, and rows from the index usually are not loaded, so load it first.
    markViewed: (entry: InboxEntry) => {
      if (!entry.ctx.data.session.get(entry.session.id)) entry.ctx.data.session.remember(entry.session)
      entry.ctx.notification.session.markViewed(entry.session.id)
    },
    archive: (entry: InboxEntry) =>
      entry.ctx.sdk.api.session
        .update({ sessionID: entry.session.id, archived: true })
        .then(() => {
          move(entry, Date.now())
          notifySessionTabsRemoved({
            server: entry.server,
            directory: entry.session.location.directory,
            sessionIDs: [entry.session.id],
          })
        })
        .catch(requestFailed),
    unarchive: (entry: InboxEntry) =>
      entry.ctx.sdk.api.session
        .update({ sessionID: entry.session.id, archived: false })
        .then(() => move(entry, undefined))
        .catch(requestFailed),
    remove: (entry: InboxEntry) => {
      const ids = sessionTreeIDs(entry.ctx.data.session.list(), entry.session.id)

      return entry.ctx.data.session
        .remove(entry.session.id)
        .then(() => {
          forget(entry.conn, entry.session.id)
          notifySessionTabsRemoved({
            server: entry.server,
            directory: entry.session.location.directory,
            sessionIDs: ids,
          })
        })
        .catch((cause) =>
          showToast({
            title: language.t("session.delete.failed.title"),
            description: errorMessage(cause, language.t("session.delete.failed.title")),
          }),
        )
    },
  }
}

export type SessionInbox = ReturnType<typeof createSessionInbox>

export function inboxArchived(entry: InboxEntry) {
  return entry.session.time.archived !== undefined
}

export function inboxBusy(status: InboxStatus) {
  return status === "working" || status === "approval" || status === "input"
}

function locationKey(entry: InboxEntry) {
  return `${entry.server}\0${pathKey(entry.session.location.directory)}`
}

export function inboxInWorktree(entry: InboxEntry) {
  const root = entry.ctx.projects.forSession(entry.session)?.worktree

  return !!root && pathKey(root) !== pathKey(entry.session.location.directory)
}
