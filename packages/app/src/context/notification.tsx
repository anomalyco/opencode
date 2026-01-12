import { createStore } from "solid-js/store"
import { createEffect, onCleanup } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSDK } from "./global-sdk"
import { useGlobalSync } from "./global-sync"
import { usePlatform } from "@/context/platform"
import { Binary } from "@opencode-ai/util/binary"
import { base64Encode } from "@opencode-ai/util/encode"
import { EventSessionError } from "@opencode-ai/sdk/v2"
import { makeAudioPlayer } from "@solid-primitives/audio"
import idleSound from "@opencode-ai/ui/audio/staplebops-01.aac"
import errorSound from "@opencode-ai/ui/audio/nope-03.aac"
import { Persist, persisted } from "@/utils/persist"

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
    let idlePlayer: ReturnType<typeof makeAudioPlayer> | undefined
    let errorPlayer: ReturnType<typeof makeAudioPlayer> | undefined

    try {
      idlePlayer = makeAudioPlayer(idleSound)
      errorPlayer = makeAudioPlayer(errorSound)
    } catch (err) {
      console.log("Failed to load audio", err)
    }

    const globalSDK = useGlobalSDK()
    const globalSync = useGlobalSync()
    const platform = usePlatform()

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
      const base = {
        directory,
        time: Date.now(),
        viewed: false,
      }
      switch (event.type) {
        case "session.idle": {
          const sessionID = event.properties.sessionID
          const [syncStore] = globalSync.child(directory)
          const match = Binary.search(syncStore.session, sessionID, (s) => s.id)
          const session = match.found ? syncStore.session[match.index] : undefined
          if (session?.parentID) break
          try {
            idlePlayer?.play()
          } catch {}
          append({
            ...base,
            type: "turn-complete",
            session: sessionID,
          })
          const href = `/${base64Encode(directory)}/session/${sessionID}`
          void platform.notify("Response ready", session?.title ?? sessionID, href)
          break
        }
        case "session.error": {
          const sessionID = event.properties.sessionID
          const [syncStore] = globalSync.child(directory)
          const match = sessionID ? Binary.search(syncStore.session, sessionID, (s) => s.id) : undefined
          const session = sessionID && match?.found ? syncStore.session[match.index] : undefined
          if (session?.parentID) break
          try {
            errorPlayer?.play()
          } catch {}
          const error = "error" in event.properties ? event.properties.error : undefined
          append({
            ...base,
            type: "error",
            session: sessionID ?? "global",
            error,
          })
          const description = session?.title ?? (typeof error === "string" ? error : "An error occurred")
          const href = sessionID ? `/${base64Encode(directory)}/session/${sessionID}` : `/${base64Encode(directory)}`
          void platform.notify("Session error", description, href)
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
