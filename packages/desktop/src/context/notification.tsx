import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { makePersisted } from "@solid-primitives/storage"
import { useGlobalSDK } from "./global-sdk"
import { useGlobalSync } from "./global-sync"
import { Binary } from "@opencode-ai/util/binary"
import { EventSessionError } from "@opencode-ai/sdk/v2"
import { makeAudioPlayer } from "@solid-primitives/audio"
import idleSound from "@opencode-ai/ui/audio/staplebops-01.aac"
import errorSound from "@opencode-ai/ui/audio/nope-03.aac"

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
    const idlePlayer = makeAudioPlayer(idleSound)
    const errorPlayer = makeAudioPlayer(errorSound)
    const globalSDK = useGlobalSDK()
    const globalSync = useGlobalSync()

    const [store, setStore] = makePersisted(
      createStore({
        list: [] as Notification[],
      }),
      {
        name: "notification.v1",
      },
    )

    // onMount(() => {
    //   const daysToKeep = 7
    //   // setStore("list", (n) => n.filter((n) => !n.viewed && n.time + 1000 * 60 * 60 * 24 * daysToKeep < Date.now()))
    // })

    globalSDK.event.listen((e) => {
      console.log(e)
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
          idlePlayer.play()
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
          errorPlayer.play()
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
