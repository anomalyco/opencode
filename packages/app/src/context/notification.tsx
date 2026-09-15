import { createStore, reconcile } from "solid-js/store"
import { type Accessor, batch, createEffect, createMemo, createRoot, getOwner, onCleanup } from "solid-js"
import { useNavigate, useParams, useSearchParams } from "@solidjs/router"
import { createSimpleContext } from "@opencode-ai/ui/context"
import type { ServerSDK } from "./server-sdk"
import type { ServerSync } from "./server-sync"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { decode64 } from "@/utils/base64"
import { EventSessionError } from "@opencode-ai/sdk/v2"
import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"
import { Persist, persisted } from "@/utils/persist"
import { playSoundById } from "@/utils/sound"
import { useGlobal } from "./global"
import { usePermission } from "./permission"
import { ServerConnection, useServer } from "./server"
import { type DraftTab, useTabs } from "./tabs"
import { requireServerKey } from "@/utils/session-route"
import type { ServerScope } from "@/utils/server-scope"
import { createTaskbarAttentionState, taskbarAttentionReady, taskbarUnreadSessions } from "./taskbar-attention"

type NotificationBase = {
  directory?: string
  session?: string
  metadata?: unknown
  time: number
  viewed: boolean
}

type TurnCompleteNotification = NotificationBase & {
  type: "turn-complete"
}

type ErrorNotification = NotificationBase & {
  type: "error"
  error: EventSessionError["properties"]["error"]
}

export type Notification = TurnCompleteNotification | ErrorNotification

type NotificationIndex = {
  session: {
    all: Record<string, Notification[]>
    unseen: Record<string, Notification[]>
    unseenCount: Record<string, number>
    unseenHasError: Record<string, boolean>
  }
  project: {
    all: Record<string, Notification[]>
    unseen: Record<string, Notification[]>
    unseenCount: Record<string, number>
    unseenHasError: Record<string, boolean>
  }
}

const MAX_NOTIFICATIONS = 500
const NOTIFICATION_TTL_MS = 1000 * 60 * 60 * 24 * 30

function pruneNotifications(list: Notification[]) {
  const cutoff = Date.now() - NOTIFICATION_TTL_MS
  const pruned = list.filter((n) => n.time >= cutoff)
  if (pruned.length <= MAX_NOTIFICATIONS) return pruned
  return pruned.slice(pruned.length - MAX_NOTIFICATIONS)
}

function createNotificationIndex(): NotificationIndex {
  return {
    session: {
      all: {},
      unseen: {},
      unseenCount: {},
      unseenHasError: {},
    },
    project: {
      all: {},
      unseen: {},
      unseenCount: {},
      unseenHasError: {},
    },
  }
}

function buildNotificationIndex(list: Notification[]) {
  const index = createNotificationIndex()

  list.forEach((notification) => {
    if (notification.session) {
      const all = index.session.all[notification.session] ?? []
      index.session.all[notification.session] = [...all, notification]
      if (!notification.viewed) {
        const unseen = index.session.unseen[notification.session] ?? []
        index.session.unseen[notification.session] = [...unseen, notification]
        index.session.unseenCount[notification.session] = unseen.length + 1
        if (notification.type === "error") index.session.unseenHasError[notification.session] = true
      }
    }

    if (notification.directory) {
      const all = index.project.all[notification.directory] ?? []
      index.project.all[notification.directory] = [...all, notification]
      if (!notification.viewed) {
        const unseen = index.project.unseen[notification.directory] ?? []
        index.project.unseen[notification.directory] = [...unseen, notification]
        index.project.unseenCount[notification.directory] = unseen.length + 1
        if (notification.type === "error") index.project.unseenHasError[notification.directory] = true
      }
    }
  })

  return index
}

export const { use: useNotification, provider: NotificationProvider } = createSimpleContext({
  name: "Notification",
  gate: false,
  init: () => {
    const params = useParams<{ serverKey?: string; dir?: string; id?: string }>()
    const [search] = useSearchParams<{ draftId?: string }>()
    const global = useGlobal()
    const permission = usePermission()
    const server = useServer()
    const tabs = useTabs()
    const navigate = useNavigate()
    const platform = usePlatform()
    const settings = useSettings()
    const language = useLanguage()
    const owner = getOwner()
    const states = new Map<ServerScope, { dispose: () => void; state: NotificationState }>()

    const syncTaskbarAttention = () => {
      if (!taskbarAttentionReady([...states.values()].map((value) => value.state))) return
      const sessions = new Set<string>()
      states.forEach((value, scope) => {
        value.state.taskbarAttentionSessions().forEach((sessionID) => sessions.add(`${scope}\0${sessionID}`))
      })
      void platform.setTaskbarAttention?.([...sessions])
    }

    const activeServer = createMemo(() => {
      if (params.serverKey) return requireServerKey(params.serverKey)
      if (search.draftId) {
        const draft = tabs.store.find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === search.draftId)
        if (draft) return draft.server
      }
      return server.key
    })
    const activeDirectory = createMemo(() => decode64(params.dir))
    const activeSession = createMemo(() => params.id)

    const ensure = (key: ServerConnection.Key) => {
      const conn = global.servers.list().find((item) => ServerConnection.key(item) === key)
      if (!conn) throw new Error(`Notification server not found: ${key}`)
      const ctx = global.ensureServerCtx(conn)
      const existing = states.get(ctx.sdk.scope)
      if (existing) return existing.state
      const permissionState = permission.ensureServerState(key)
      const root = createRoot(
        (dispose) => ({
          dispose,
          state: createServerNotificationState({
            sdk: ctx.sdk,
            sync: ctx.sync,
            active: () => server.scope(activeServer()) === ctx.sdk.scope,
            directory: activeDirectory,
            sessionID: activeSession,
            platform,
            settings,
            language,
            navigate,
            isPermissionAutoResponded: permissionState.autoResponds,
            onTaskbarAttentionChanged: syncTaskbarAttention,
          }),
        }),
        owner ?? undefined,
      )
      states.set(ctx.sdk.scope, root)
      syncTaskbarAttention()
      return root.state
    }

    createEffect(() => {
      global.servers.list().forEach((conn) => ensure(ServerConnection.key(conn)))
    })

    createEffect(() => {
      const scopes = new Set(global.servers.list().map((conn) => server.scope(ServerConnection.key(conn))))
      states.forEach((value, scope) => {
        if (scopes.has(scope)) return
        value.dispose()
        states.delete(scope)
      })
      syncTaskbarAttention()
    })

    onCleanup(() => states.forEach((value) => value.dispose()))

    const selected = () => {
      const list = global.servers.list()
      const key = activeServer()
      if (list.some((conn) => ServerConnection.key(conn) === key)) return ensure(key)
      const conn = list.find((conn) => ServerConnection.key(conn) === server.key) ?? list[0]
      if (!conn) throw new Error("Notification server not found")
      return ensure(ServerConnection.key(conn))
    }

    const markSessionViewed = (sessionID: string) => {
      const state = selected()
      const attention = state.session.hasTaskbarAttention(sessionID)
      state.session.markViewed(sessionID)
      if (!attention) return
      void platform.markTaskbarSessionViewed?.(`${server.scope(activeServer())}\0${sessionID}`)
    }

    const clearFocusedSessionTaskbarAttention = () => {
      if (!platform.setTaskbarAttention) return
      const sessionID = activeSession()
      if (!sessionID) return
      markSessionViewed(sessionID)
    }
    window.addEventListener("focus", clearFocusedSessionTaskbarAttention)
    onCleanup(() => window.removeEventListener("focus", clearFocusedSessionTaskbarAttention))
    const stopTaskbarSessionViewed = platform.onTaskbarSessionViewed?.((key) => {
      const split = key.indexOf("\0")
      if (split === -1) return
      const value = states.get(key.slice(0, split) as ServerScope)
      if (!value) return
      value.state.session.markViewed(key.slice(split + 1))
    })
    if (stopTaskbarSessionViewed) onCleanup(stopTaskbarSessionViewed)

    return {
      ready: () => selected().ready(),
      ensureServerState: ensure,
      session: {
        all: (session: string) => selected().session.all(session),
        unseen: (session: string) => selected().session.unseen(session),
        unseenCount: (session: string) => selected().session.unseenCount(session),
        unseenHasError: (session: string) => selected().session.unseenHasError(session),
        markViewed: markSessionViewed,
      },
      project: {
        all: (directory: string) => selected().project.all(directory),
        unseen: (directory: string) => selected().project.unseen(directory),
        unseenCount: (directory: string) => selected().project.unseenCount(directory),
        unseenHasError: (directory: string) => selected().project.unseenHasError(directory),
        markViewed: (directory: string) => selected().project.markViewed(directory),
      },
    }
  },
})

type NotificationState = ReturnType<typeof createServerNotificationState>

function createServerNotificationState(input: {
  sdk: ServerSDK
  sync: ServerSync
  active: Accessor<boolean>
  directory: Accessor<string | undefined>
  sessionID: Accessor<string | undefined>
  platform: ReturnType<typeof usePlatform>
  settings: ReturnType<typeof useSettings>
  language: ReturnType<typeof useLanguage>
  navigate: (href: string) => void
  isPermissionAutoResponded: (request: PermissionRequest, directory?: string) => boolean
  onTaskbarAttentionChanged: () => void
}) {
  const serverSDK = () => input.sdk
  const serverSync = () => input.sync
  const platform = input.platform
  const settings = input.settings
  const language = input.language
  const windowFocused = () => document.hasFocus()

  const empty: Notification[] = []

  const currentDirectory = input.directory
  const currentSession = input.sessionID
  const taskbarAttention = createTaskbarAttentionState()

  const [store, setStore, _, ready] = persisted(
    Persist.serverGlobal(serverSDK().scope, "notification", ["notification.v1"]),
    createStore({
      list: [] as Notification[],
    }),
  )
  const [index, setIndex] = createStore<NotificationIndex>(buildNotificationIndex(store.list))
  const taskbarAttentionSessions = () => {
    const unread = taskbarUnreadSessions(index.session.unseen)
    const pending = new Map<string, string>()
    Object.entries(input.sync.session.data.permission).forEach(([sessionID, requests]) => {
      const active = requests.filter(
        (request) => !input.isPermissionAutoResponded(request, input.sync.session.data.info[sessionID]?.directory),
      )
      if (!active.length) return
      pending.set(sessionID, `permission:${active.map((request) => request.id).join(",")}`)
    })
    Object.entries(input.sync.session.data.question).forEach(([sessionID, requests]) => {
      if (!requests.length) return
      const token = `question:${requests.map((request) => request.id).join(",")}`
      pending.set(sessionID, pending.has(sessionID) ? `${pending.get(sessionID)}|${token}` : token)
    })
    taskbarAttention.sync([...pending].map(([sessionID, token]) => ({ sessionID, token })))
    if (input.active() && windowFocused()) {
      const sessionID = currentSession()
      if (sessionID) taskbarAttention.remove(sessionID)
    }
    return taskbarAttention.sessions(unread)
  }

  const meta = { pruned: false, disposed: false }

  const updateUnseen = (scope: "session" | "project", key: string, unseen: Notification[]) => {
    setIndex(scope, "unseen", key, unseen)
    setIndex(scope, "unseenCount", key, unseen.length)
    setIndex(
      scope,
      "unseenHasError",
      key,
      unseen.some((notification) => notification.type === "error"),
    )
  }

  const appendToIndex = (notification: Notification) => {
    if (notification.session) {
      setIndex("session", "all", notification.session, (all = []) => [...all, notification])
      if (!notification.viewed) {
        setIndex("session", "unseen", notification.session, (unseen = []) => [...unseen, notification])
        setIndex("session", "unseenCount", notification.session, (count = 0) => count + 1)
        if (notification.type === "error") setIndex("session", "unseenHasError", notification.session, true)
      }
    }

    if (notification.directory) {
      setIndex("project", "all", notification.directory, (all = []) => [...all, notification])
      if (!notification.viewed) {
        setIndex("project", "unseen", notification.directory, (unseen = []) => [...unseen, notification])
        setIndex("project", "unseenCount", notification.directory, (count = 0) => count + 1)
        if (notification.type === "error") setIndex("project", "unseenHasError", notification.directory, true)
      }
    }
  }

  const removeFromIndex = (notification: Notification) => {
    if (notification.session) {
      setIndex("session", "all", notification.session, (all = []) => all.filter((n) => n !== notification))
      if (!notification.viewed) {
        const unseen = (index.session.unseen[notification.session] ?? empty).filter((n) => n !== notification)
        updateUnseen("session", notification.session, unseen)
      }
    }

    if (notification.directory) {
      setIndex("project", "all", notification.directory, (all = []) => all.filter((n) => n !== notification))
      if (!notification.viewed) {
        const unseen = (index.project.unseen[notification.directory] ?? empty).filter((n) => n !== notification)
        updateUnseen("project", notification.directory, unseen)
      }
    }
  }

  createEffect(() => {
    if (!ready()) return
    if (meta.pruned) return
    meta.pruned = true
    const list = pruneNotifications(store.list)
    batch(() => {
      setStore("list", list)
      setIndex(reconcile(buildNotificationIndex(list), { merge: false }))
    })
  })

  createEffect(() => {
    if (!ready()) return
    taskbarAttentionSessions()
    input.onTaskbarAttentionChanged()
  })

  const append = (notification: Notification) => {
    const list = pruneNotifications([...store.list, notification])
    const keep = new Set(list)
    const removed = store.list.filter((n) => !keep.has(n))

    batch(() => {
      if (keep.has(notification)) appendToIndex(notification)
      removed.forEach((n) => removeFromIndex(n))
      setStore("list", list)
    })
    input.onTaskbarAttentionChanged()
  }

  const lookup = async (directory: string, sessionID?: string) => {
    if (!sessionID) return undefined
    const sync = serverSync().ensureDirSyncContext(directory)
    const session = sync.session.get(sessionID)
    if (session) return session
    return sync.session
      .sync(sessionID)
      .then(() => sync.session.get(sessionID))
      .catch(() => undefined)
  }

  const viewedInCurrentSession = (directory: string, sessionID?: string) => {
    if (!input.active()) return false
    const activeDirectory = currentDirectory()
    const activeSession = currentSession()
    if (!activeSession) return false
    if (!sessionID) return false
    if (activeDirectory && directory !== activeDirectory) return false
    return sessionID === activeSession
  }

  const handleSessionIdle = (directory: string, event: { properties: { sessionID?: string } }, time: number) => {
    const sessionID = event.properties.sessionID
    void lookup(directory, sessionID).then((session) => {
      if (meta.disposed) return
      if (!session) return
      if (session.parentID) return

      taskbarAttention.remove(sessionID ?? "global")
      const focused = windowFocused()
      const viewed = viewedInCurrentSession(directory, sessionID)
      if (!viewed || !focused) taskbarAttention.add(sessionID ?? "global")
      if (viewed && focused && sessionID) {
        void platform.markTaskbarSessionViewed?.(`${input.sdk.scope}\0${sessionID}`)
      }

      if (settings.sounds.agentEnabled()) {
        void playSoundById(settings.sounds.agent())
      }

      append({
        directory,
        time,
        viewed,
        type: "turn-complete",
        session: sessionID,
      })

      const href = `/${base64Encode(directory)}/session/${sessionID}`
      if (settings.notifications.agent()) {
        void platform.notify(language.t("notification.session.responseReady.title"), session.title ?? sessionID, () =>
          input.navigate(href),
        )
      }
    })
  }

  const handleSessionError = (
    directory: string,
    event: { properties: { sessionID?: string; error?: EventSessionError["properties"]["error"] } },
    time: number,
  ) => {
    const sessionID = event.properties.sessionID
    void lookup(directory, sessionID).then((session) => {
      if (meta.disposed) return
      if (session?.parentID) return

      taskbarAttention.remove(sessionID ?? "global")
      const focused = windowFocused()
      const viewed = viewedInCurrentSession(directory, sessionID)
      if (!viewed || !focused) taskbarAttention.add(sessionID ?? "global")
      if (viewed && focused && sessionID) {
        void platform.markTaskbarSessionViewed?.(`${input.sdk.scope}\0${sessionID}`)
      }

      if (settings.sounds.errorsEnabled()) {
        void playSoundById(settings.sounds.errors())
      }

      const error = "error" in event.properties ? event.properties.error : undefined
      append({
        directory,
        time,
        viewed,
        type: "error",
        session: sessionID ?? "global",
        error,
      })
      const description =
        session?.title ??
        (typeof error === "string" ? error : language.t("notification.session.error.fallbackDescription"))
      const href = sessionID ? `/${base64Encode(directory)}/session/${sessionID}` : `/${base64Encode(directory)}`
      if (settings.notifications.errors()) {
        void platform.notify(language.t("notification.session.error.title"), description, () => input.navigate(href))
      }
    })
  }

  const unsub = serverSDK().event.listen((e) => {
    const event = e.details
    if (event.type === "permission.asked" || event.type === "question.asked") {
      const sessionID = event.properties.sessionID
      if (!sessionID) return
      if (event.type === "permission.asked" && input.isPermissionAutoResponded(event.properties, e.name)) return
      const viewed = viewedInCurrentSession(e.name, sessionID)
      if (viewed && windowFocused()) {
        taskbarAttention.remove(sessionID)
        void platform.markTaskbarSessionViewed?.(`${input.sdk.scope}\0${sessionID}`)
        input.onTaskbarAttentionChanged()
        return
      }
      const prefix = event.type === "permission.asked" ? "permission" : "question"
      taskbarAttention.add(sessionID, `${prefix}:${event.properties.id}`)
      input.onTaskbarAttentionChanged()
      return
    }
    if (
      event.type === "permission.replied" ||
      event.type === "question.replied" ||
      event.type === "question.rejected"
    ) {
      const prefix = event.type === "permission.replied" ? "permission" : "question"
      taskbarAttention.removePending(event.properties.sessionID, `${prefix}:${event.properties.requestID}`)
      input.onTaskbarAttentionChanged()
      return
    }
    if (event.type !== "session.idle" && event.type !== "session.error") return

    const directory = e.name
    const time = Date.now()
    if (event.type === "session.idle") {
      handleSessionIdle(directory, event, time)
      return
    }
    handleSessionError(directory, event, time)
  })
  onCleanup(() => {
    meta.disposed = true
    unsub()
  })

  return {
    ready,
    session: {
      all(session: string) {
        return index.session.all[session] ?? empty
      },
      unseen(session: string) {
        return index.session.unseen[session] ?? empty
      },
      unseenCount(session: string) {
        return index.session.unseenCount[session] ?? 0
      },
      unseenHasError(session: string) {
        return index.session.unseenHasError[session] ?? false
      },
      hasTaskbarAttention(session: string) {
        if ((index.session.unseen[session] ?? empty).length) return true
        const directory = input.sync.session.data.info[session]?.directory
        if (
          input.sync.session.data.permission[session]?.some(
            (request) => !input.isPermissionAutoResponded(request, directory),
          )
        ) {
          return true
        }
        return !!input.sync.session.data.question[session]?.length
      },
      markViewed(session: string) {
        taskbarAttention.remove(session)
        const unseen = index.session.unseen[session] ?? empty
        if (!unseen.length) {
          input.onTaskbarAttentionChanged()
          return
        }

        const projects = [
          ...new Set(unseen.flatMap((notification) => (notification.directory ? [notification.directory] : []))),
        ]
        batch(() => {
          setStore("list", (n) => n.session === session && !n.viewed, "viewed", true)
          updateUnseen("session", session, [])
          projects.forEach((directory) => {
            const next = (index.project.unseen[directory] ?? empty).filter(
              (notification) => notification.session !== session,
            )
            updateUnseen("project", directory, next)
          })
        })
        input.onTaskbarAttentionChanged()
      },
    },
    project: {
      all(directory: string) {
        return index.project.all[directory] ?? empty
      },
      unseen(directory: string) {
        return index.project.unseen[directory] ?? empty
      },
      unseenCount(directory: string) {
        return index.project.unseenCount[directory] ?? 0
      },
      unseenHasError(directory: string) {
        return index.project.unseenHasError[directory] ?? false
      },
      markViewed(directory: string) {
        const unseen = index.project.unseen[directory] ?? empty
        if (!unseen.length) return

        const sessions = [
          ...new Set(unseen.flatMap((notification) => (notification.session ? [notification.session] : []))),
        ]
        batch(() => {
          setStore("list", (n) => n.directory === directory && !n.viewed, "viewed", true)
          updateUnseen("project", directory, [])
          sessions.forEach((session) => {
            taskbarAttention.remove(session)
            const next = (index.session.unseen[session] ?? empty).filter(
              (notification) => notification.directory !== directory,
            )
            updateUnseen("session", session, next)
          })
        })
        input.onTaskbarAttentionChanged()
      },
    },
    taskbarAttentionSessions,
  }
}
