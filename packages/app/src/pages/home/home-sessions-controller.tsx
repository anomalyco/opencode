import type { SessionInfo } from "@opencode-ai/client/promise"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { skipToken, useQuery } from "@tanstack/solid-query"
import { DateTime } from "luxon"
import { type Accessor, createEffect, createMemo, type JSX, startTransition, untrack } from "solid-js"
import { useCommand } from "@/context/command"
import {
  loadHomeSessionIndex,
  mergeHomeSessionIndex,
  retainHomeSessions,
} from "@/context/global-sync/home-session-index"
import type { LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/servers"
import { sessionHasOpenTab, useTabs } from "@/context/tabs"
import { errorMessage } from "@/pages/layout/helpers"
import { useSessionTabAvatarState } from "@/pages/layout/project-avatar-state"
import { pathKey } from "@/utils/path-key"
import { showToast } from "@/utils/toast"
import { archiveHomeSession } from "../home-session-archive"
import type { HomeController } from "./home-controller"
import { buildHomeSessionRecords, type HomeSessionRecord } from "./home-session-records"

export type { HomeSessionRecord } from "./home-session-records"

const HOME_SESSION_LIMIT = 64
// Keep the large immutable result opaque so Solid Query does not recursively unwrap every session on mount.
const selectSessions = (sessions: SessionInfo[]) => () => sessions
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
  const projectDirectories = createMemo(() => {
    const selected = home.selection.value().directory
    if (!selected) return
    const project = home.project.selected()
    return project ? directories(project) : [selected]
  })
  const sessionLoad = useQuery(() => {
    const ctx = home.server.focusedContext()
    const conn = home.server.focused()
    return {
      queryKey: ["home-sessions", conn] as const,
      enabled: !!ctx && ctx.sdk.connection.status() === "connected",
      queryFn: ctx
        ? ({ signal }) => loadHomeSessionIndex((input, options) => ctx.sdk.api.session.list(input, options), signal)
        : skipToken,
      retry: false,
      staleTime: 30_000,
      refetchOnMount: true,
      refetchOnReconnect: true,
      select: selectSessions,
    }
  })
  const indexedSessions = createMemo(() => {
    const ctx = home.server.focusedContext()
    if (!ctx) return []
    return retainHomeSessions(
      mergeHomeSessionIndex(sessionLoad.data?.() ?? [], ctx.data.session.list()),
      HOME_SESSION_LIMIT,
      Date.now(),
    )
  })
  const allRecords = createMemo(() =>
    buildHomeSessionRecords({
      sessions: indexedSessions,
      projectDirectories,
      projects: home.project.list,
    }),
  )
  const records = createMemo(() => allRecords().slice(0, HOME_SESSION_LIMIT))
  const groups = createMemo(() => groupSessions(records(), language))
  const prefetched = new Set<string>()

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

  command.register("home.palette", () => [
    {
      id: "command.palette",
      title: language.t("command.palette"),
      hidden: true,
      onSelect: async () => {
        const conn = home.server.focused()
        if (!conn) return
        const ctx = home.server.focusedContext()
        if (!ctx) return
        const { DialogHomeCommandPaletteV2 } = await import("@/components/dialog-command-palette-v2")
        void dialog.show(() => (
          <DialogHomeCommandPaletteV2
            server={conn}
            onSelectSession={(entry) => {
              if (!entry.sessionID || !entry.directory || !entry.server) return
              const sessionID = entry.sessionID
              const server = entry.server
              const directory = entry.project?.worktree ?? entry.directory
              ctx.projects.open(directory)
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

  return {
    copy: {
      language,
    },
    data: {
      records,
      groups,
      loading: () => sessionLoad.isLoading,
      searchRecords: allRecords,
    },
    session: {
      showProjectName: () => !home.project.selected(),
      server: () => home.selection.value().server,
      canCreate: () => !!home.project.newSession(),
      create: home.project.openNewSession,
      open: (session: SessionInfo, options?: OpenSessionOptions) => {
        const directoryKey = pathKey(session.location.directory)
        const project =
          home.project
            .list()
            .find(
              (item) =>
                pathKey(item.worktree) === directoryKey ||
                item.sandboxes?.some((sandbox) => pathKey(sandbox) === directoryKey),
            )
        const conn = home.server.focused()
        if (!conn) return
        const connKey = ServerConnection.key(conn)
        const directory = project?.worktree ?? session.location.directory
        const ctx = home.server.focusedContext()
        if (!ctx) return
        ctx.data.session.remember(session)
        ctx.projects.open(directory)
        if (options?.background) {
          tabs.addSessionTab({ server: connKey, sessionId: session.id })
          return
        }
        ctx.projects.touch(directory)
        void startTransition(() => {
          const tab = tabs.addSessionTab({ server: connKey, sessionId: session.id })
          tabs.select(tab)
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
    },
    tab: {
      isOpen: (record: HomeSessionRecord) =>
        sessionHasOpenTab(tabs.store, home.selection.value().server, record.session),
    },
  }
}

function directories(project: LocalProject) {
  return [project.worktree, ...(project.sandboxes ?? [])]
}

export function homeSessionSearchKey(record: HomeSessionRecord) {
  return `${pathKey(record.session.location.directory)}:${record.session.id}`
}

function groupSessions(records: HomeSessionRecord[], language: ReturnType<typeof useLanguage>): HomeSessionGroup[] {
  const now = DateTime.local()
  const yesterday = now.minus({ days: 1 })
  const todaySessions = records.filter((record) =>
    DateTime.fromMillis(record.session.time.updated ?? record.session.time.created).hasSame(now, "day"),
  )
  const yesterdaySessions = records.filter((record) =>
    DateTime.fromMillis(record.session.time.updated ?? record.session.time.created).hasSame(yesterday, "day"),
  )
  const olderSessions = records.filter((record) => {
    const time = DateTime.fromMillis(record.session.time.updated ?? record.session.time.created)
    return !time.hasSame(now, "day") && !time.hasSame(yesterday, "day")
  })
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
    () => props.record.session.location.directory,
    () => props.record.session.id,
    () => true,
  )
  return props.render({
    unread: avatar.unread,
    loading: avatar.loading,
    open: () => props.isOpenTab(props.record),
  })
}
