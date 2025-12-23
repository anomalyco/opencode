import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSDK } from "./global-sdk"
import { useGlobalSync } from "./global-sync"
import { Binary } from "@opencode-ai/util/binary"
import { EventSessionError } from "@opencode-ai/sdk/v2"
import { makeAudioPlayer } from "@solid-primitives/audio"
import idleSound from "@opencode-ai/ui/audio/staplebops-01.aac"
import errorSound from "@opencode-ai/ui/audio/nope-03.aac"
import { persisted } from "@/utils/persist"

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

    const [store, setStore, _, ready] = persisted(
      "notification.v1",
      createStore({
        list: [] as Notification[],
      }),
    )

    globalSDK.event.listen((e) => {
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
          const isChild = match.found && syncStore.session[match.index].parentID
          if (isChild) break
          try {
            idlePlayer?.play()
          } catch {}
          setStore("list", store.list.length, {
            ...base,
            type: "turn-complete",
            session: sessionID,
          })
          break
        }
        case "session.error": {
          const sessionID = event.properties.sessionID
          if (sessionID) {
            const [syncStore] = globalSync.child(directory)
            const match = Binary.search(syncStore.session, sessionID, (s) => s.id)
            const isChild = match.found && syncStore.session[match.index].parentID
            if (isChild) break
          }
          try {
            errorPlayer?.play()
          } catch {}
          setStore("list", store.list.length, {
            ...base,
            type: "error",
            session: sessionID ?? "global",
            error: "error" in event.properties ? event.properties.error : undefined,
          })
          break
        }
      }
    })

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
