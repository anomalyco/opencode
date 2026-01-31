import { createStore } from "solid-js/store"
import { createEffect, createMemo, onCleanup } from "solid-js"
import { useParams } from "@solidjs/router"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSDK } from "./global-sdk"
import { useGlobalSync } from "./global-sync"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { Binary } from "@opencode-ai/util/binary"
import { base64Encode } from "@opencode-ai/util/encode"
import { decode64 } from "@/utils/base64"
import { EventSessionError } from "@opencode-ai/sdk/v2"
import { Persist, persisted } from "@/utils/persist"
import { playSound, soundSrc } from "@/utils/sound"

type NotificationBase = {
  directory?: string
  session?: string
  metadata?: any
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

const MAX_NOTIFICATIONS = 500
const NOTIFICATION_TTL_MS = 1000 * 60 * 60 * 24 * 30

function pruneNotifications(list: Notification[]) {
  const cutoff = Date.now() - NOTIFICATION_TTL_MS
  const pruned = list.filter((n) => n.time >= cutoff)
  if (pruned.length <= MAX_NOTIFICATIONS) return pruned
  return pruned.slice(pruned.length - MAX_NOTIFICATIONS)
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

    const empty: Notification[] = []

    const currentDirectory = createMemo(() => {
      return decode64(params.dir)
    })

    const currentSession = createMemo(() => params.id)

    const [store, setStore, _, ready] = persisted(
      Persist.global("notification", ["notification.v1"]),
      createStore({
        list: [] as Notification[],
      }),
    )

    const meta = { pruned: false }

    createEffect(() => {
      if (!ready()) return
      if (meta.pruned) return
      meta.pruned = true
      setStore("list", pruneNotifications(store.list))
    })

    const append = (notification: Notification) => {
      setStore("list", (list) => pruneNotifications([...list, notification]))
    }

    const index = createMemo(() => {
      const sessionAll = new Map<string, Notification[]>()
      const sessionUnseen = new Map<string, Notification[]>()
      const projectAll = new Map<string, Notification[]>()
      const projectUnseen = new Map<string, Notification[]>()

      for (const notification of store.list) {
        const session = notification.session
        if (session) {
          const list = sessionAll.get(session)
          if (list) list.push(notification)
          else sessionAll.set(session, [notification])
          if (!notification.viewed) {
            const unseen = sessionUnseen.get(session)
            if (unseen) unseen.push(notification)
            else sessionUnseen.set(session, [notification])
          }
        }

        const directory = notification.directory
        if (directory) {
          const list = projectAll.get(directory)
          if (list) list.push(notification)
          else projectAll.set(directory, [notification])
          if (!notification.viewed) {
            const unseen = projectUnseen.get(directory)
            if (unseen) unseen.push(notification)
            else projectUnseen.set(directory, [notification])
          }
        }
      }

      return {
        session: {
          all: sessionAll,
          unseen: sessionUnseen,
        },
        project: {
          all: projectAll,
          unseen: projectUnseen,
        },
      }
    })

    const unsub = globalSDK.event.listen((e) => {
      const event = e.details
      if (event.type !== "session.idle" && event.type !== "session.error") return

      const directory = e.name
      const time = Date.now()
      const viewed = (sessionID?: string) => {
        const activeDirectory = currentDirectory()
        const activeSession = currentSession()
        if (!activeDirectory) return false
        if (!activeSession) return false
        if (!sessionID) return false
        if (directory !== activeDirectory) return false
        return sessionID === activeSession
      }
      switch (event.type) {
        case "session.idle": {
          const sessionID = event.properties.sessionID
          const [syncStore] = globalSync.child(directory, { bootstrap: false })
          const match = Binary.search(syncStore.session, sessionID, (s) => s.id)
          const session = match.found ? syncStore.session[match.index] : undefined
          if (session?.parentID) break

          playSound(soundSrc(settings.sounds.agent()))

          append({
            directory,
            time,
            viewed: viewed(sessionID),
            type: "turn-complete",
            session: sessionID,
          })

          const href = `/${base64Encode(directory)}/session/${sessionID}`
          if (settings.notifications.agent()) {
            void platform.notify(
              language.t("notification.session.responseReady.title"),
              session?.title ?? sessionID,
              href,
            )
          }
          break
        }
        case "session.error": {
          const sessionID = event.properties.sessionID
          const [syncStore] = globalSync.child(directory, { bootstrap: false })
          const match = sessionID ? Binary.search(syncStore.session, sessionID, (s) => s.id) : undefined
          const session = sessionID && match?.found ? syncStore.session[match.index] : undefined
          if (session?.parentID) break

          playSound(soundSrc(settings.sounds.errors()))

          const error = "error" in event.properties ? event.properties.error : undefined
          append({
            directory,
            time,
            viewed: viewed(sessionID),
            type: "error",
            session: sessionID ?? "global",
            error,
          })
          const description =
            session?.title ??
            (typeof error === "string" ? error : language.t("notification.session.error.fallbackDescription"))
          const href = sessionID ? `/${base64Encode(directory)}/session/${sessionID}` : `/${base64Encode(directory)}`
          if (settings.notifications.errors()) {
            void platform.notify(language.t("notification.session.error.title"), description, href)
          }
          break
        }
      }
    })
    onCleanup(unsub)

    return {
      ready,
      session: {
        all(session: string) {
          return index().session.all.get(session) ?? empty
        },
        unseen(session: string) {
          return index().session.unseen.get(session) ?? empty
        },
        markViewed(session: string) {
          setStore("list", (n) => n.session === session, "viewed", true)
        },
      },
      project: {
        all(directory: string) {
          return index().project.all.get(directory) ?? empty
        },
        unseen(directory: string) {
          return index().project.unseen.get(directory) ?? empty
        },
        markViewed(directory: string) {
          setStore("list", (n) => n.directory === directory, "viewed", true)
        },
      },
    }
  },
})
