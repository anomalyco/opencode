import { createStore } from "solid-js/store"
import { createEffect, onCleanup } from "solid-js"
import { useParams } from "@solidjs/router"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSDK } from "./global-sdk"
import { useGlobalSync } from "./global-sync"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { Binary } from "@opencode-ai/util/binary"
import { base64Decode, base64Encode } from "@opencode-ai/util/encode"
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

    const unsub = globalSDK.event.listen((e) => {
      const directory = e.name
      const event = e.details
      const time = Date.now()
      const activeDirectory = params.dir ? base64Decode(params.dir) : undefined
      const activeSession = params.id
      const viewed = (sessionID?: string) => {
        if (!activeDirectory) return false
        if (!activeSession) return false
        if (!sessionID) return false
        if (directory !== activeDirectory) return false
        return sessionID === activeSession
      }
      switch (event.type) {
        case "session.idle": {
          const sessionID = event.properties.sessionID
          const [syncStore] = globalSync.child(directory)
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
          const [syncStore] = globalSync.child(directory)
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
          return store.list.filter((n) => n.session === session)
        },
        unseen(session: string) {
          return store.list.filter((n) => n.session === session && !n.viewed)
        },
        markViewed(session: string) {
          setStore("list", (n) => n.session === session, "viewed", true)
        },
      },
      project: {
        all(directory: string) {
          return store.list.filter((n) => n.directory === directory)
        },
        unseen(directory: string) {
          return store.list.filter((n) => n.directory === directory && !n.viewed)
        },
        markViewed(directory: string) {
          setStore("list", (n) => n.directory === directory, "viewed", true)
        },
      },
    }
  },
})
