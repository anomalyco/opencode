import type { AutomationInfo, SessionInfo } from "@opencode/client/promise"
import { displayName } from "@opencode/ui/project-avatar"
import { createEffect, createMemo, createSignal, onCleanup, startTransition } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { sessionTitle } from "@/session/title"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { useLayout } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import {
  type AutomationFilter,
  automationTitle,
  compareSchedules,
  matchesAutomationQuery,
} from "./format"

// Shared per-server schedule cache so sidebar badges and the /automations screen stay in lockstep.
const [cache, setCache] = createStore<{
  schedules: Record<string, AutomationInfo[] | undefined>
  loading: Record<string, boolean | undefined>
}>({
  schedules: {},
  loading: {},
})

// Monotonic write counter per server so an older in-flight poll never overwrites a newer pause, resume, or delete.
const cacheEpoch: Record<string, number | undefined> = {}

function bumpEpoch(serverKey: ServerConnection.Key) {
  cacheEpoch[serverKey] = (cacheEpoch[serverKey] ?? 0) + 1
}

export function resetAutomationsCacheForTest() {
  for (const key of Object.keys(cacheEpoch)) delete cacheEpoch[key]
  setCache({ schedules: {}, loading: {} })
}

async function fetchServerSchedules(
  serverKey: ServerConnection.Key,
  listSchedules: (signal: AbortSignal) => Promise<AutomationInfo[]>,
  signal: AbortSignal,
) {
  const startedEpoch = cacheEpoch[serverKey] ?? 0
  setCache("loading", serverKey, true)

  try {
    const items = await listSchedules(signal)

    if (!signal.aborted && (cacheEpoch[serverKey] ?? 0) === startedEpoch) {
      setCache("schedules", serverKey, [...items])
    }
  } catch {
    if (!signal.aborted && (cacheEpoch[serverKey] ?? 0) === startedEpoch && cache.schedules[serverKey] === undefined) {
      setCache("schedules", serverKey, [])
    }
  } finally {
    if (!signal.aborted) setCache("loading", serverKey, false)
  }
}

export type AutomationEntry = {
  key: string
  conn: ServerConnection.Any
  server: ServerConnection.Key
  serverLabel: string
  ctx: ReturnType<ReturnType<typeof useGlobal>["ensureServerCtx"]>
  schedule: AutomationInfo
  session: SessionInfo | undefined
  projectName: string | undefined
  directory: string | undefined
}

export function useActiveAutomationCount() {
  const global = useGlobal()
  const servers = useServers()

  const connections = createMemo(() => servers.visible.map((conn) => ({ conn, ctx: global.ensureServerCtx(conn) })))

  createEffect(() => {
    const list = connections()
    const controller = new AbortController()

    const syncAll = () => {
      list.forEach((item) => {
        if (item.ctx.sdk.connection.status() !== "connected") return
        const serverKey = ServerConnection.key(item.conn)
        void fetchServerSchedules(
          serverKey,
          (signal) => item.ctx.sdk.api.experimental.automation.list(undefined, { signal }),
          controller.signal,
        )
      })
    }

    syncAll()
    const interval = setInterval(syncAll, 15_000)

    onCleanup(() => {
      controller.abort()
      clearInterval(interval)
    })
  })

  return createMemo(() =>
    connections().reduce((total, item) => {
      const list = cache.schedules[ServerConnection.key(item.conn)] ?? []

      return total + list.filter((entry) => entry.status === "active").length
    }, 0),
  )
}

export function createAutomationsController() {
  const global = useGlobal()
  const servers = useServers()
  const layout = useLayout()
  const tabs = useTabs()
  const language = useLanguage()

  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 1_000)
  onCleanup(() => clearInterval(timer))

  const [state, setState] = createStore<{
    filter: AutomationFilter
    query: string
    selectedKey: string | undefined
    busy: Record<string, boolean | undefined>
    syncedSessions: Record<string, true | undefined>
  }>({
    filter: "all",
    query: "",
    selectedKey: undefined,
    busy: {},
    syncedSessions: {},
  })

  const connections = createMemo(() => servers.visible.map((conn) => ({ conn, ctx: global.ensureServerCtx(conn) })))

  let activeController: AbortController | undefined

  const refresh = () => {
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller

    connections().forEach((item) => {
      if (item.ctx.sdk.connection.status() !== "connected") return
      const serverKey = ServerConnection.key(item.conn)
      void fetchServerSchedules(
        serverKey,
        (signal) => item.ctx.sdk.api.experimental.automation.list(undefined, { signal }),
        controller.signal,
      )
    })
  }

  createEffect(() => {
    connections().forEach((item) => item.ctx.sdk.connection.status())
    refresh()
    const interval = setInterval(refresh, 5_000)

    onCleanup(() => {
      activeController?.abort()
      clearInterval(interval)
    })
  })

  const entries = createMemo(() =>
    connections()
      .flatMap((item) => {
        const server = ServerConnection.key(item.conn)
        const list = cache.schedules[server] ?? []
        const serverLabel = servers.label(item.conn)

        return list.map((schedule): AutomationEntry => {
          const session = schedule.sessionID ? item.ctx.data.session.get(schedule.sessionID) : undefined
          const project = session ? item.ctx.projects.forSession(session) : undefined
          const directory = session?.location.directory ?? project?.worktree

          return {
            key: `${server}\0${schedule.id}`,
            conn: item.conn,
            server,
            serverLabel,
            ctx: item.ctx,
            schedule,
            session,
            projectName: project
              ? displayName(project)
              : session
                ? displayName({ worktree: session.location.directory })
                : undefined,
            directory,
          }
        })
      })
      .toSorted((a, b) => compareSchedules(a.schedule, b.schedule)),
  )

  // Hydrate session metadata lazily for automations whose session has not been opened yet in this client.
  createEffect(() => {
    entries().forEach((entry) => {
      const sessionID = entry.schedule.sessionID

      if (!sessionID || entry.session) return
      const syncKey = `${entry.server}\0${sessionID}`

      if (state.syncedSessions[syncKey]) return
      setState("syncedSessions", syncKey, true)
      void entry.ctx.data.session.sync(sessionID).catch(() => undefined)
    })
  })

  const counts = createMemo(() => {
    const all = entries()

    return {
      all: all.length,
      active: all.filter((entry) => entry.schedule.status === "active").length,
      paused: all.filter((entry) => entry.schedule.status === "paused").length,
      done: all.filter((entry) => entry.schedule.status === "done").length,
    }
  })

  const filtered = createMemo(() => {
    const activeFilter = state.filter
    const query = state.query

    return entries().filter((entry) => {
      if (activeFilter !== "all" && entry.schedule.status !== activeFilter) return false
      const sessionName = entry.session ? (sessionTitle(entry.session.title) ?? "") : ""
      const extra = [entry.projectName ?? "", sessionName, entry.serverLabel].join(" ")

      return matchesAutomationQuery(entry.schedule, query, extra)
    })
  })

  createEffect(() => {
    const list = filtered()

    if (list.length === 0) return

    if (state.selectedKey && list.some((entry) => entry.key === state.selectedKey)) return
    setState("selectedKey", list[0]?.key)
  })

  const selected = createMemo(() => {
    const key = state.selectedKey

    if (!key) return filtered()[0]

    return filtered().find((entry) => entry.key === key) ?? entries().find((entry) => entry.key === key)
  })

  const loading = createMemo(() =>
    connections().some((item) => {
      const server = ServerConnection.key(item.conn)

      return item.ctx.sdk.connection.status() === "connected" && cache.schedules[server] === undefined && Boolean(cache.loading[server])
    }),
  )

  const togglePause = async (entry: AutomationEntry) => {
    if (entry.schedule.status === "done" || state.busy[entry.key]) return
    setState("busy", entry.key, true)

    try {
      const updated =
        entry.schedule.status === "active"
          ? await entry.ctx.sdk.api.experimental.automation.pause({ automationID: entry.schedule.id })
          : await entry.ctx.sdk.api.experimental.automation.resume({ automationID: entry.schedule.id })

      bumpEpoch(entry.server)
      setCache("schedules", entry.server, (current) =>
        (current ?? []).map((item) => (item.id === updated.id ? updated : item)),
      )
    } catch (error) {
      showToast({ variant: "error", title: errorMessage(error, "Failed to update automation") })
    } finally {
      setState("busy", entry.key, undefined)
    }
  }

  const remove = async (entry: AutomationEntry) => {
    if (state.busy[entry.key]) return
    setState("busy", entry.key, true)

    try {
      await entry.ctx.sdk.api.experimental.automation.delete({ automationID: entry.schedule.id })
      bumpEpoch(entry.server)
      setCache("schedules", entry.server, (current) => (current ?? []).filter((item) => item.id !== entry.schedule.id))
    } catch (error) {
      showToast({ variant: "error", title: errorMessage(error, "Failed to delete automation") })
    } finally {
      setState("busy", entry.key, undefined)
    }
  }

  const openSession = (entry: AutomationEntry) => {
    const sessionId = entry.schedule.sessionID

    if (!sessionId) return

    if (entry.directory) entry.ctx.projects.touch(entry.directory)
    void startTransition(() => {
      tabs.select(tabs.addSessionTab({ server: entry.server, sessionId }))
    })
  }

  const openNewAutomation = (starterPrompt = "/automate ") => {
    const current = selected()

    if (current?.directory) {
      void tabs.newDraft({ server: current.server, directory: current.directory }, starterPrompt)

      return
    }

    const selection = layout.home.selection()

    const conn =
      servers.visible.find((item) => ServerConnection.key(item) === selection.server) ?? servers.visible[0]

    if (!conn) return
    const ctx = global.ensureServerCtx(conn)

    const project =
      ctx.projects.list().find((item) => item.worktree === selection.directory) ??
      ctx.projects.last() ??
      ctx.projects.list()[0]

    if (!project) return
    void tabs.newDraft({ server: ServerConnection.key(conn), directory: project.worktree }, starterPrompt)
  }

  return {
    language,
    now,
    loading,
    multiServer: () => servers.visible.length > 1,
    filter: () => state.filter,
    setFilter: (next: AutomationFilter) => setState("filter", next),
    query: () => state.query,
    setQuery: (next: string) => setState("query", next),
    counts,
    entries,
    filtered,
    selected,
    select: (key: string) => setState("selectedKey", key),
    busy: (key: string) => Boolean(state.busy[key]),
    refresh,
    togglePause,
    remove,
    openSession,
    openNewAutomation,
    titleFor: (entry: AutomationEntry) => automationTitle(entry.schedule),
  }
}
