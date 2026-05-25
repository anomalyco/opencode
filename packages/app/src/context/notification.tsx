import { createStore, reconcile } from "solid-js/store"
import { batch, createEffect, createMemo, onCleanup } from "solid-js"
import { useParams } from "@solidjs/router"
import { showToast } from "@opencode-ai/ui/toast"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSDK } from "./global-sdk"
import { useGlobalSync } from "./global-sync"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { Binary } from "@opencode-ai/core/util/binary"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { decode64 } from "@/utils/base64"
import { EventSessionError } from "@opencode-ai/sdk/v2"
import { Persist, persisted } from "@/utils/persist"
import { playSoundById } from "@/utils/sound"
import { formatServerError } from "@/utils/server-errors"
import { markCurrentNotifications, type Notification } from "./notification-state"
import { useServer } from "./server"
import { domainFromDirectory, mainDomain, type DomainId } from "@/pages/layout/extra-agents"

type NotificationIndexPerDomain = {
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

type NotificationIndex = {
  byDomain: Partial<Record<DomainId, NotificationIndexPerDomain>>
}

const MAX_NOTIFICATIONS = 500
const NOTIFICATION_TTL_MS = 1000 * 60 * 60 * 24 * 30
const ERROR_SOUND_LOG = "opencode.error-sound.dat"
const ERROR_SOUND_KEY = "error-sound.v1"
const ERROR_SOUND_MAX = 200
const QUICK_ASSISTANT_TITLE = "Quick Assistant"
const QUICK_ASSISTANT_DIR = "quick-assistant"

type ErrorSoundLog = {
  time: number
  directory: string
  sessionID?: string
  sessionTitle?: string
  sound?: string
  error?: unknown
}

function pruneNotifications(list: Notification[]) {
  const cutoff = Date.now() - NOTIFICATION_TTL_MS
  const pruned = list.filter((n) => n.time >= cutoff)
  if (pruned.length <= MAX_NOTIFICATIONS) return pruned
  return pruned.slice(pruned.length - MAX_NOTIFICATIONS)
}

function errorText(error: EventSessionError["properties"]["error"]) {
  if (!error) return
  if (typeof error === "string") return error
  if (typeof error !== "object") return String(error)
  const data = "data" in error ? error.data : undefined
  if (data && typeof data === "object" && "message" in data && typeof data.message === "string") return data.message
  if ("name" in error && typeof error.name === "string") return error.name
  return JSON.stringify(error)
}

function joinPath(root: string, child: string) {
  const slash = /^[A-Za-z]:\\|\\\\/.test(root) || root.includes("\\") ? "\\" : "/"
  return root.replace(/[\\/]+$/, "") + slash + child
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

async function logErrorSound(
  platform: ReturnType<typeof usePlatform>,
  input: {
    directory: string
    sessionID?: string
    sessionTitle?: string
    sound?: string
    error?: EventSessionError["properties"]["error"]
  },
) {
  const storage = platform.storage?.(ERROR_SOUND_LOG)
  if (!storage) return
  const prev = await Promise.resolve(storage.getItem(ERROR_SOUND_KEY)).catch(() => null)
  const list = (() => {
    if (!prev) return [] as ErrorSoundLog[]
    try {
      const data = JSON.parse(prev) as unknown
      return Array.isArray(data) ? (data as ErrorSoundLog[]) : []
    } catch {
      return [] as ErrorSoundLog[]
    }
  })()
  const item = {
    time: Date.now(),
    directory: input.directory,
    sessionID: input.sessionID,
    sessionTitle: input.sessionTitle,
    sound: input.sound,
    error: {
      raw: input.error,
      text: errorText(input.error),
    },
  } satisfies ErrorSoundLog
  const next = [...list.slice(-(ERROR_SOUND_MAX - 1)), item]
  console.error("error sound", item)
  await Promise.resolve(storage.setItem(ERROR_SOUND_KEY, JSON.stringify(next))).catch(() => undefined)
}

function createNotificationIndexPerDomain(): NotificationIndexPerDomain {
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

function createNotificationIndex(): NotificationIndex {
  return {
    byDomain: {},
  }
}

function buildNotificationIndex(listByDomain: Partial<Record<DomainId, Notification[]>>) {
  const index = createNotificationIndex()

  for (const [domain, list] of Object.entries(listByDomain)) {
    if (!list) continue
    const domainIndex = createNotificationIndexPerDomain()

    list.forEach((notification) => {
      if (notification.session) {
        const all = domainIndex.session.all[notification.session] ?? []
        domainIndex.session.all[notification.session] = [...all, notification]
        if (!notification.viewed) {
          const unseen = domainIndex.session.unseen[notification.session] ?? []
          domainIndex.session.unseen[notification.session] = [...unseen, notification]
          domainIndex.session.unseenCount[notification.session] = unseen.length + 1
          if (notification.type === "error") domainIndex.session.unseenHasError[notification.session] = true
        }
      }

      if (notification.directory) {
        const all = domainIndex.project.all[notification.directory] ?? []
        domainIndex.project.all[notification.directory] = [...all, notification]
        if (!notification.viewed) {
          const unseen = domainIndex.project.unseen[notification.directory] ?? []
          domainIndex.project.unseen[notification.directory] = [...unseen, notification]
          domainIndex.project.unseenCount[notification.directory] = unseen.length + 1
          if (notification.type === "error") domainIndex.project.unseenHasError[notification.directory] = true
        }
      }
    })

    index.byDomain[domain as DomainId] = domainIndex
  }

  return index
}

export const { use: useNotification, provider: NotificationProvider } = createSimpleContext({
  name: "Notification",
  init: () => {
    const params = useParams()
    const globalSDK = useGlobalSDK()
    const globalSync = useGlobalSync()
    const platform = usePlatform()
    const settings = useSettings()
    const language = useLanguage()
    const server = useServer()

    const empty: Notification[] = []

    const currentDirectory = createMemo(() => {
      return decode64(params.dir)
    })

    const currentSession = createMemo(() => params.id)
    const currentDomain = createMemo(() => server.domain)

    const [store, setStore, _, ready] = persisted(
      {
        ...Persist.global("notification", ["notification.v1", "notification.v2"]),
        migrate(value) {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            return { byDomain: { [mainDomain]: [] as Notification[] } }
          }
          const data = value as Record<string, unknown>
          if ("byDomain" in data) return value
          const list = Array.isArray(data.list) ? (data.list as Notification[]) : []
          return { byDomain: { [mainDomain]: list } }
        },
      },
      createStore({
        byDomain: { [mainDomain]: [] as Notification[] } as Partial<Record<DomainId, Notification[]>>,
      }),
    )
    const [index, setIndex] = createStore<NotificationIndex>(buildNotificationIndex(store.byDomain))

    const meta = { pruned: false, disposed: false }

    const domainIndex = () => index.byDomain[currentDomain()] ?? createNotificationIndexPerDomain()

    const updateUnseen = (domain: DomainId, scope: "session" | "project", key: string, unseen: Notification[]) => {
      setIndex("byDomain", domain, scope, "unseen", key, unseen)
      setIndex("byDomain", domain, scope, "unseenCount", key, unseen.length)
      setIndex(
        "byDomain",
        domain,
        scope,
        "unseenHasError",
        key,
        unseen.some((notification) => notification.type === "error"),
      )
    }

    const appendToIndex = (notification: Notification, domain: DomainId) => {
      if (!index.byDomain[domain]) {
        setIndex("byDomain", domain, createNotificationIndexPerDomain())
      }

      if (notification.session) {
        setIndex("byDomain", domain, "session", "all", notification.session, (all = []) => [...all, notification])
        if (!notification.viewed) {
          setIndex("byDomain", domain, "session", "unseen", notification.session, (unseen = []) => [
            ...unseen,
            notification,
          ])
          setIndex("byDomain", domain, "session", "unseenCount", notification.session, (count = 0) => count + 1)
          if (notification.type === "error")
            setIndex("byDomain", domain, "session", "unseenHasError", notification.session, true)
        }
      }

      if (notification.directory) {
        setIndex("byDomain", domain, "project", "all", notification.directory, (all = []) => [...all, notification])
        if (!notification.viewed) {
          setIndex("byDomain", domain, "project", "unseen", notification.directory, (unseen = []) => [
            ...unseen,
            notification,
          ])
          setIndex("byDomain", domain, "project", "unseenCount", notification.directory, (count = 0) => count + 1)
          if (notification.type === "error")
            setIndex("byDomain", domain, "project", "unseenHasError", notification.directory, true)
        }
      }
    }

    const removeFromIndex = (notification: Notification, domain: DomainId) => {
      const domainIdx = index.byDomain[domain]
      if (!domainIdx) return

      if (notification.session) {
        setIndex("byDomain", domain, "session", "all", notification.session, (all = []) =>
          all.filter((n) => n !== notification),
        )
        if (!notification.viewed) {
          const unseen = (domainIdx.session.unseen[notification.session] ?? empty).filter((n) => n !== notification)
          updateUnseen(domain, "session", notification.session, unseen)
        }
      }

      if (notification.directory) {
        setIndex("byDomain", domain, "project", "all", notification.directory, (all = []) =>
          all.filter((n) => n !== notification),
        )
        if (!notification.viewed) {
          const unseen = (domainIdx.project.unseen[notification.directory] ?? empty).filter((n) => n !== notification)
          updateUnseen(domain, "project", notification.directory, unseen)
        }
      }
    }

    createEffect(() => {
      if (!ready()) return
      if (meta.pruned) return
      meta.pruned = true
      const prunedByDomain: Partial<Record<DomainId, Notification[]>> = {}
      for (const [domain, list] of Object.entries(store.byDomain)) {
        if (!list) continue
        prunedByDomain[domain as DomainId] = pruneNotifications(list)
      }
      batch(() => {
        setStore("byDomain", reconcile(prunedByDomain, { merge: false }))
        setIndex(reconcile(buildNotificationIndex(prunedByDomain), { merge: false }))
      })
    })

    const append = (notification: Notification, domain: DomainId) => {
      const domainList = store.byDomain[domain] ?? []
      const list = pruneNotifications([...domainList, notification])
      const keep = new Set(list)
      const removed = domainList.filter((n) => !keep.has(n))

      batch(() => {
        if (keep.has(notification)) appendToIndex(notification, domain)
        removed.forEach((n) => removeFromIndex(n, domain))
        setStore("byDomain", domain, list)
      })
    }

    const lookup = async (directory: string, sessionID?: string) => {
      if (!sessionID) return undefined
      const [syncStore] = globalSync.child(directory, { bootstrap: false })
      const match = Binary.search(syncStore.session, sessionID, (s) => s.id)
      if (match.found) return syncStore.session[match.index]
      const domain = domainFromDirectory(directory)
      return globalSDK.forDomain(domain).client.session
        .get({ directory, sessionID })
        .then((x) => x.data)
        .catch(() => undefined)
    }

    const viewedInCurrentSession = (directory: string, sessionID?: string) => {
      const activeDirectory = currentDirectory()
      const activeSession = currentSession()
      if (!activeDirectory) return false
      if (!activeSession) return false
      if (!sessionID) return false
      if (directory !== activeDirectory) return false
      return sessionID === activeSession
    }

    const isQuickAssistantSession = (directory: string, session: { title?: string } | undefined) => {
      const config = globalSync.data.path.config
      if (!config) return false
      if (session?.title !== QUICK_ASSISTANT_TITLE) return false
      return normalizePath(directory) === normalizePath(joinPath(config, QUICK_ASSISTANT_DIR))
    }

    const handleSessionIdle = (
      directory: string,
      event: { properties: { sessionID?: string } },
      time: number,
      domain: DomainId,
    ) => {
      const sessionID = event.properties.sessionID
      void lookup(directory, sessionID).then((session) => {
        if (meta.disposed) return
        if (!session) return
        if (session.parentID) return
        if (isQuickAssistantSession(directory, session)) return

        if (settings.sounds.agentEnabled()) {
          void playSoundById(settings.sounds.agent())
        }

        append(
          {
            directory,
            time,
            viewed: viewedInCurrentSession(directory, sessionID),
            type: "turn-complete",
            session: sessionID,
          },
          domain,
        )

        const href = `/${base64Encode(directory)}/session/${sessionID}`
        if (settings.notifications.agent()) {
          void platform.notify(language.t("notification.session.responseReady.title"), session.title ?? sessionID, href)
        }
      })
    }

    const handleSessionError = (
      directory: string,
      event: { properties: { sessionID?: string; error?: EventSessionError["properties"]["error"] } },
      time: number,
      domain: DomainId,
    ) => {
      const sessionID = event.properties.sessionID
      void lookup(directory, sessionID).then((session) => {
        if (meta.disposed) return
        if (session?.parentID) return

        if (settings.sounds.errorsEnabled()) {
          void logErrorSound(platform, {
            directory,
            sessionID,
            sessionTitle: session?.title,
            sound: settings.sounds.errors(),
            error: "error" in event.properties ? event.properties.error : undefined,
          })
          void playSoundById(settings.sounds.errors())
        }

        const error = "error" in event.properties ? event.properties.error : undefined
        append(
          {
            directory,
            time,
            viewed: viewedInCurrentSession(directory, sessionID),
            type: "error",
            session: sessionID ?? "global",
            error,
          },
          domain,
        )
        const description =
          session?.title ??
          (typeof error === "string" ? error : language.t("notification.session.error.fallbackDescription"))
        const href = sessionID ? `/${base64Encode(directory)}/session/${sessionID}` : `/${base64Encode(directory)}`
        if (settings.notifications.errors()) {
          void platform.notify(language.t("notification.session.error.title"), description, href)
        }
        if (!sessionID) {
          showToast({
            title: language.t("notification.session.error.title"),
            description: formatServerError(error, language.t, language.t("notification.session.error.fallbackDescription")),
          })
        }
      })
    }

    const unsub = globalSDK.listenAll((e) => {
      const event = e.details
      if (event.type !== "session.idle" && event.type !== "session.error") return

      const directory = e.name
      const domain = e.domain
      const time = Date.now()
      if (event.type === "session.idle") {
        handleSessionIdle(directory, event, time, domain)
        return
      }
      handleSessionError(directory, event, time, domain)
    })

    const markCurrent = () => {
      const directory = currentDirectory()
      const session = currentSession()
      const domain = currentDomain()
      if (!directory) return
      if (!session) return
      const domainIdx = index.byDomain[domain]
      if (!domainIdx) return
      const unseen = domainIdx.session.unseen[session] ?? empty
      if (unseen.length === 0) return
      if (!unseen.some((item) => item.directory === directory)) return

      const domainList = store.byDomain[domain] ?? []
      const nextList = markCurrentNotifications(domainList, session, directory)
      if (nextList === domainList) return
      batch(() => {
        setStore("byDomain", domain, nextList)
        const nextSession = unseen.filter((item) => item.directory !== directory)
        updateUnseen(domain, "session", session, nextSession)
        const nextProject = (domainIdx.project.unseen[directory] ?? empty).filter((item) => item.session !== session)
        updateUnseen(domain, "project", directory, nextProject)
      })
    }

    createEffect(() => {
      if (!ready()) return
      currentDirectory()
      currentSession()
      markCurrent()
    })

    const syncCurrent = () => {
      if (document.visibilityState === "hidden") return
      markCurrent()
    }

    window.addEventListener("focus", syncCurrent)
    document.addEventListener("visibilitychange", syncCurrent)
    onCleanup(() => {
      meta.disposed = true
      unsub()
      window.removeEventListener("focus", syncCurrent)
      document.removeEventListener("visibilitychange", syncCurrent)
    })

    return {
      ready,
      session: {
        all(session: string) {
          return domainIndex().session.all[session] ?? empty
        },
        unseen(session: string) {
          return domainIndex().session.unseen[session] ?? empty
        },
        unseenCount(session: string) {
          return domainIndex().session.unseenCount[session] ?? 0
        },
        unseenHasError(session: string) {
          return domainIndex().session.unseenHasError[session] ?? false
        },
        markViewed(session: string) {
          const domain = currentDomain()
          const domainIdx = index.byDomain[domain]
          if (!domainIdx) return
          const unseen = domainIdx.session.unseen[session] ?? empty
          if (!unseen.length) return

          const projects = [
            ...new Set(unseen.flatMap((notification) => (notification.directory ? [notification.directory] : []))),
          ]
          batch(() => {
            setStore("byDomain", domain, (n) => n.session === session && !n.viewed, "viewed", true)
            updateUnseen(domain, "session", session, [])
            projects.forEach((directory) => {
              const next = (domainIdx.project.unseen[directory] ?? empty).filter(
                (notification) => notification.session !== session,
              )
              updateUnseen(domain, "project", directory, next)
            })
          })
        },
      },
      project: {
        all(directory: string) {
          const domain = domainFromDirectory(directory)
          const domainIdx = index.byDomain[domain] ?? createNotificationIndexPerDomain()
          return domainIdx.project.all[directory] ?? empty
        },
        unseen(directory: string) {
          const domain = domainFromDirectory(directory)
          const domainIdx = index.byDomain[domain] ?? createNotificationIndexPerDomain()
          return domainIdx.project.unseen[directory] ?? empty
        },
        unseenCount(directory: string) {
          const domain = domainFromDirectory(directory)
          const domainIdx = index.byDomain[domain] ?? createNotificationIndexPerDomain()
          return domainIdx.project.unseenCount[directory] ?? 0
        },
        unseenHasError(directory: string) {
          const domain = domainFromDirectory(directory)
          const domainIdx = index.byDomain[domain] ?? createNotificationIndexPerDomain()
          return domainIdx.project.unseenHasError[directory] ?? false
        },
        markViewed(directory: string) {
          const domain = domainFromDirectory(directory)
          const domainIdx = index.byDomain[domain]
          if (!domainIdx) return
          const unseen = domainIdx.project.unseen[directory] ?? empty
          if (!unseen.length) return

          const sessions = [
            ...new Set(unseen.flatMap((notification) => (notification.session ? [notification.session] : []))),
          ]
          batch(() => {
            setStore("byDomain", domain, (n) => n.directory === directory && !n.viewed, "viewed", true)
            updateUnseen(domain, "project", directory, [])
            sessions.forEach((session) => {
              const next = (domainIdx.session.unseen[session] ?? empty).filter(
                (notification) => notification.directory !== directory,
              )
              updateUnseen(domain, "session", session, next)
            })
          })
        },
      },
    }
  },
})
