import type { SessionInfo } from "@opencode-ai/client/promise"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Button } from "@opencode-ai/ui/button"
import { DialogFooter, DialogHeader, DialogTitleGroup, Dialog } from "@opencode-ai/ui/dialog"
import { skipToken, useQuery, useQueryClient } from "@tanstack/solid-query"
import { DateTime } from "luxon"
import { type Accessor, createEffect, createMemo, type JSX, startTransition, untrack } from "solid-js"
import { notifySessionTabsRemoved } from "@/shell/titlebar/session-events"
import { useCommand } from "@/shell/commands/command"
import {
  HOME_SESSION_LIMIT,
  loadHomeSessionIndex,
  mergeHomeSessionIndex,
  retainHomeSessions,
} from "@/home/sessions/index"
import type { LocalProject } from "@/shell/state/layout"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { sessionHasOpenTab, useTabs } from "@/shell/tabs/tabs"
import { errorMessage } from "@/shell/layout/helpers"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import { removedSessionIDs } from "@/session/session-domain"
import { pathKey } from "@/workspaces/path-key"
import { fetchSessionExport, saveSessionExport, sessionExportFilename } from "@/session/commands/export"
import { usePlatform } from "@/runtime/platform/platform"
import { sessionLabel, sessionTitle } from "@/session/title"
import { showToast } from "@/shell/notifications/toast"
import { archiveHomeSession } from "./archive"
import type { HomeController } from "../model"
import { buildHomeSessionRecords, type HomeSessionRecord } from "./records"

export type { HomeSessionRecord } from "./records"

// Keep the immutable result opaque so Solid Query does not recursively unwrap every session on mount.
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
  const platform = usePlatform()
  const queryClient = useQueryClient()
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
    const conn = home.server.focused()
    if (!ctx || !conn) return []
    return retainHomeSessions(
      ctx.data.session.apply(
        mergeHomeSessionIndex(sessionLoad.isPending ? [] : (sessionLoad.data?.() ?? []), ctx.data.session.list()),
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
        const { HomeCommandPalette } = await import("./command-palette")
        void dialog.show(() => (
          <HomeCommandPalette
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

  const rename = async (server: ServerConnection.Key, session: SessionInfo, title: string) => {
    const conn = home.server.list().find((item) => ServerConnection.key(item) === server)
    const ctx = conn ? home.server.context(conn) : undefined
    if (!conn || !ctx) return false
    const next = title.trim()
    if (!next || next === sessionLabel(session)) return true
    return ctx.sdk.api.session
      .rename({ sessionID: session.id, title: next })
      .then(() => {
        ctx.data.session.remember({ ...(ctx.data.session.get(session.id) ?? session), title: next })
        // Rename advances time.updated server-side; re-sync the canonical
        // record so date grouping and ordering do not go stale.
        ctx.data.session.invalidate(session.id)
        void ctx.data.session.sync(session.id).catch(() => {})
        queryClient.setQueryData<SessionInfo[]>(["home-sessions", conn], (current) =>
          current?.map((item) => (item.id === session.id ? { ...item, title: next } : item)),
        )
        return true
      })
      .catch((cause) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(cause, language.t("common.requestFailed")),
        })
        return false
      })
  }

  const exportSession = async (server: ServerConnection.Key, session: SessionInfo) => {
    const conn = home.server.list().find((item) => ServerConnection.key(item) === server)
    const ctx = conn ? home.server.context(conn) : undefined
    if (!ctx) return
    try {
      const data = await fetchSessionExport({ sessionID: session.id, api: ctx.sdk.api })
      const filename = sessionExportFilename(data.info)
      if (!(await saveSessionExport(filename, data, platform))) return
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename }),
      })
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("toast.session.export.failed.title"),
        description: cause instanceof Error ? cause.message : language.t("toast.session.export.failed.description"),
      })
    }
  }

  const remove = async (server: ServerConnection.Key, session: SessionInfo) => {
    const conn = home.server.list().find((item) => ServerConnection.key(item) === server)
    const ctx = conn ? home.server.context(conn) : undefined
    if (!conn || !ctx) return false
    const ids = [...removedSessionIDs(ctx.data.session.list(), session.id)]
    return ctx.data.session
      .remove(session.id)
      .then(() => {
        notifySessionTabsRemoved({
          server: ServerConnection.key(conn),
          directory: session.location.directory,
          sessionIDs: ids,
        })
        return true
      })
      .catch((cause) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(cause, language.t("session.delete.failed.title")),
        })
        return false
      })
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: ["home-sessions", conn], exact: true })
      })
  }

  function DeleteDialog(props: { server: ServerConnection.Key; session: SessionInfo }) {
    const name = () => sessionTitle(props.session.title) ?? language.t("command.session.new")
    const confirm = async () => {
      await remove(props.server, props.session)
      dialog.close()
    }
    return (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("session.delete.title")}
            description={language.t("session.delete.confirm", { name: name() })}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={confirm}>
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
      loading: () => sessionLoad.isPending,
      searchRecords: allRecords,
    },
    session: {
      showProjectName: () => !home.project.selected(),
      server: () => home.selection.value().server,
      canCreate: () => !!home.project.newSession(),
      lookup: async (sessionID: string) => {
        const ctx = home.server.focusedContext()
        if (!ctx) return
        const result = await ctx.sdk.api.session.get({ sessionID })
        if (result.time.archived) return
        return buildHomeSessionRecords({
          sessions: () => [result],
          projectDirectories,
          projects: home.project.list,
        })[0]
      },
      create: home.project.openNewSession,
      open: (session: SessionInfo, options?: OpenSessionOptions) => {
        const directoryKey = pathKey(session.location.directory)
        const project = home.project
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
        if (!options?.background) void ctx.data.session.message.sync(session.id).catch(() => undefined)
        // Commit cache/project changes with navigation instead of rebuilding
        // the outgoing Home list before leaving it.
        void startTransition(() => {
          const tab = tabs.addSessionTab({ server: connKey, sessionId: session.id })
          if (!options?.background) tabs.select(tab)
          ctx.data.session.remember(session)
          ctx.projects.open(directory)
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
      export: exportSession,
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
    () => props.record.session.id,
    () => true,
  )
  return props.render({
    unread: avatar.unread,
    loading: avatar.loading,
    open: () => props.isOpenTab(props.record),
  })
}
