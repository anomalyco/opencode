import type { Session } from "@opencode-ai/sdk/v2/client"
import { preloadMarkdown } from "@opencode-ai/session-ui/markdown-cache"
import { notifySessionTabsRemoved } from "@/components/titlebar-session-events"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useQuery } from "@tanstack/solid-query"
import { DateTime } from "luxon"
import { type Accessor, createEffect, createMemo, createRoot, type JSX, startTransition } from "solid-js"
import { useCommand } from "@/context/command"
import {
  loadHomeSessionIndex,
  retainHomeSessions,
  type HomeSessionEvents,
} from "@/context/global-sync/home-session-index"
import type { LocalProject } from "@/context/layout"
import { useNavigate } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/server"
import { sessionHasOpenTab, useTabs } from "@/context/tabs"
import { compareSessionTime, displayName, errorMessage, projectForSession } from "@/pages/layout/helpers"
import { useSessionTabAvatarState } from "@/pages/layout/project-avatar-state"
import { pathKey } from "@/utils/path-key"
import { createSessionMutation } from "@/utils/session-mutation"
import { showToast } from "@/utils/toast"
import {
  fetchSessionExport,
  downloadSessionExport,
  sessionExportFilename,
} from "@/utils/session-export"
import { base64Encode } from "@opencode-ai/core/util/encode"
import type { HomeController } from "./home-controller"

const HOME_SESSION_LIMIT = 64
export type HomeSessionRecord = {
  session: Session
  project: LocalProject
  projectName: string
}

export type HomeSessionGroup = {
  id: "today" | "yesterday" | "older"
  title: string
  sessions: HomeSessionRecord[]
}

export type OpenSessionOptions = { background?: boolean }

export function createHomeSessionsController(home: HomeController) {
  const navigate = useNavigate()
  const tabs = useTabs()
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const projectDirectories = createMemo(() => {
    const project = home.project.selected()
    if (!project) return home.project.list().flatMap(directories)
    return directories(project)
  })
  const projectByID = createMemo(
    () => new Map(home.project.list().flatMap((project) => (project.id ? [[project.id, project] as const] : []))),
  )
  const homeSessions = () => home.server.focusedSync().homeSessions
  const sessionEventLoad = useQuery(() => ({
    queryKey: homeSessions().eventsKey,
    queryFn: async (): Promise<HomeSessionEvents> => ({ sequence: 0, entries: [] }),
    initialData: { sequence: 0, entries: [] } satisfies HomeSessionEvents,
    enabled: false,
  }))
  const sessionLoad = useQuery(() => ({
    queryKey: homeSessions().indexKey,
    enabled: !!home.server.focusedContext(),
    queryFn: async ({ signal }) => {
      const ctx = home.server.focusedContext()
      if (!ctx) return { sessions: [], eventSequence: 0 }
      const cache = homeSessions()
      const eventSequence = cache.eventSequence()
      const index = await loadHomeSessionIndex(
        (input, options) => ctx.sdk.client.v2.session.list(input, options),
        eventSequence,
        signal,
      )
      cache.complete(eventSequence)
      cache.setInitial(index.sessions)
      return index
    },
    retry: false,
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnReconnect: true,
  }))
  const indexedSessions = createMemo(() => {
    const cache = homeSessions()
    const raw = cache.state.ready ? cache.state.sessions : cache.sessions(sessionLoad.data, sessionEventLoad.data)
    return retainHomeSessions(raw, HOME_SESSION_LIMIT, Date.now())
  })
  const allRecords = createMemo(() =>
    buildHomeSessionRecords({
      sessions: indexedSessions,
      projectDirectories,
      projects: home.project.list,
      projectByID,
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
        createRoot((dispose) => {
          try {
            void ctx.sync.session
              .sync(record.session.id)
              .then(() =>
                Promise.all(
                  (ctx.sync.session.data.message[record.session.id] ?? []).flatMap((message) =>
                    (ctx.sync.session.data.part[message.id] ?? []).flatMap((part) => {
                      if (part.type !== "text" || !part.text) return []
                      return preloadMarkdown(part.text, part.id)
                    }),
                  ),
                ),
              )
              .catch(() => {})
              .finally(dispose)
          } catch {
            dispose()
          }
        })
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
      shareEnabled: () => home.server.focusedSync().data.config.share !== "disabled",
      create: home.project.openNewSession,
      open: (session: Session, options?: OpenSessionOptions) => {
        const directoryKey = pathKey(session.directory)
        const project =
          home.project
            .list()
            .find(
              (item) =>
                pathKey(item.worktree) === directoryKey ||
                item.sandboxes?.some((sandbox) => pathKey(sandbox) === directoryKey),
            ) ?? projectForSession(session, home.project.list(), projectByID())
        const conn = home.server.focused()
        if (!conn) return
        const directory = project?.worktree ?? session.directory
        const ctx = home.server.focusedContext()
        if (!ctx) return
        ctx.projects.open(directory)
        if (options?.background) {
          tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id })
          return
        }
        ctx.projects.touch(directory)
        void startTransition(() => {
          const tab = tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id })
          tabs.select(tab)
        })
      },
      archive: async (session: Session) => {
        const conn = home.server.focused()
        const ctx = home.server.focusedContext()
        if (!conn || !ctx) return
        try {
          await createSessionMutation({
            client: ctx.sdk.ensureDirSdkContext(session.directory).client,
            serverSync: ctx.sync,
          }).archive(session)
          notifySessionTabsRemoved({
            server: ServerConnection.key(conn),
            directory: session.directory,
            sessionIDs: [session.id],
          })
        } catch (cause) {
          showToast({
            title: language.t("common.requestFailed"),
            description: errorMessage(cause, language.t("common.requestFailed")),
          })
        }
      },
      rename: async (session: Session, title: string) => {
        if (!title || title === session.title) return
        const ctx = home.server.focusedContext()
        if (!ctx) return
        try {
          await createSessionMutation({
            client: ctx.sdk.ensureDirSdkContext(session.directory).client,
            serverSync: ctx.sync,
          }).rename(session, title)
        } catch (cause) {
          showToast({
            title: language.t("common.requestFailed"),
            description: errorMessage(cause, language.t("common.requestFailed")),
          })
        }
      },
      share: async (session: Session) => {
        const ctx = home.server.focusedContext()
        if (!ctx) return
        try {
          return await createSessionMutation({
            client: ctx.sdk.ensureDirSdkContext(session.directory).client,
            serverSync: ctx.sync,
          }).publish(session)
        } catch (cause) {
          showToast({
            title: language.t("toast.session.share.failed.title"),
            description: errorMessage(cause, language.t("toast.session.share.failed.description")),
          })
        }
      },
      unshare: async (session: Session): Promise<boolean> => {
        const ctx = home.server.focusedContext()
        if (!ctx) return false
        try {
          await createSessionMutation({
            client: ctx.sdk.ensureDirSdkContext(session.directory).client,
            serverSync: ctx.sync,
          }).unpublish(session)
          return true
        } catch (cause) {
          showToast({
            title: language.t("toast.session.unshare.failed.title"),
            description: errorMessage(cause, language.t("toast.session.unshare.failed.description")),
          })
          return false
        }
      },
      exportSession: async (session: Session) => {
        const ctx = home.server.focusedContext()
        if (!ctx) return
        try {
          const data = await fetchSessionExport({
            sessionID: session.id,
            client: ctx.sdk.ensureDirSdkContext(session.directory).client,
          })
          const filename = sessionExportFilename(data.info)
          downloadSessionExport(filename, data)
          showToast({
            title: language.t("toast.session.export.success.title"),
            description: language.t("toast.session.export.success.description", { filename }),
          })
        } catch (cause) {
          showToast({
            title: language.t("toast.session.export.failed.title"),
            description: errorMessage(cause, language.t("toast.session.export.failed.description")),
          })
        }
      },
      delete: async (session: Session): Promise<boolean> => {
        const ctx = home.server.focusedContext()
        if (!ctx) return false
        try {
          const removed = await createSessionMutation({
            client: ctx.sdk.ensureDirSdkContext(session.directory).client,
            serverSync: ctx.sync,
          }).delete(session)
          notifySessionTabsRemoved({
            server: home.selection.value().server,
            directory: session.directory,
            sessionIDs: [...removed],
          })
          return true
        } catch (cause) {
          showToast({
            title: language.t("session.delete.failed.title"),
            description: errorMessage(cause, language.t("session.delete.failed.title")),
          })
          return false
        }
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

function buildHomeSessionRecords(input: {
  sessions: () => Session[]
  projectDirectories: () => string[]
  projects: () => LocalProject[]
  projectByID: () => Map<string, LocalProject>
}) {
  const directories = new Set(input.projectDirectories().map(pathKey))
  const sessions = input.sessions().filter((session) => directories.has(pathKey(session.directory)))
  return [...new Map(sessions.map((session) => [session.id, session] as const)).values()]
    .sort(compareSessionTime)
    .flatMap((session) => {
      const directory = pathKey(session.directory)
      const project =
        input
          .projects()
          .find(
            (item) =>
              pathKey(item.worktree) === directory || item.sandboxes?.some((sandbox) => pathKey(sandbox) === directory),
          ) ?? projectForSession(session, input.projects(), input.projectByID())
      if (!project) return []
      return { session, project, projectName: displayName(project) }
    })
}

export function homeSessionSearchKey(record: HomeSessionRecord) {
  return `${pathKey(record.session.directory)}:${record.session.id}`
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
  server: Accessor<ServerConnection.Key>
  record: HomeSessionRecord
  isOpenTab: (record: HomeSessionRecord) => boolean
  render: (state: { unread: Accessor<boolean>; loading: Accessor<boolean>; open: Accessor<boolean> }) => JSX.Element
}) {
  const avatar = useSessionTabAvatarState(
    props.server,
    () => props.record.session.directory,
    () => props.record.session.id,
  )
  return props.render({
    unread: avatar.unread,
    loading: avatar.loading,
    open: () => props.isOpenTab(props.record),
  })
}
