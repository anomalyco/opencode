import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSDK } from "./global-sdk"
import { useGlobalSync } from "./global-sync"
import { useWorktree } from "./worktree"
import { usePlatform } from "@/context/platform"
import { Binary } from "@opencode-ai/util/binary"
import { base64Encode } from "@opencode-ai/util/encode"
import { EventSessionError } from "@opencode-ai/sdk/v2"
import { makeAudioPlayer } from "@solid-primitives/audio"
import idleSound from "@opencode-ai/ui/audio/staplebops-01.aac"
import errorSound from "@opencode-ai/ui/audio/nope-03.aac"
import { persisted } from "@/utils/persist"

type NotificationBase = {
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
    const worktree = useWorktree()
    const platform = usePlatform()

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
          setStore("list", store.list.length, {
            ...base,
            type: "turn-complete",
            session: sessionID,
          })
          const projectDirectory = worktree.project(sessionID) ?? session?.directory ?? directory
          const href = `/${base64Encode(projectDirectory)}/session/${sessionID}`
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
          setStore("list", store.list.length, {
            ...base,
            type: "error",
            session: sessionID ?? "global",
            error,
          })
          const description = session?.title ?? (typeof error === "string" ? error : "An error occurred")
          const projectDirectory = sessionID
            ? (worktree.project(sessionID) ?? session?.directory ?? directory)
            : directory
          const href = sessionID
            ? `/${base64Encode(projectDirectory)}/session/${sessionID}`
            : `/${base64Encode(projectDirectory)}`
          void platform.notify("Session error", description, href)
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
          const [syncStore] = globalSync.child(directory)
          const ids = new Set(syncStore.session.map((s) => s.id))
          return store.list.filter((n) => !!n.session && ids.has(n.session))
        },
        unseen(directory: string) {
          const [syncStore] = globalSync.child(directory)
          const ids = new Set(syncStore.session.map((s) => s.id))
          return store.list.filter((n) => !!n.session && ids.has(n.session) && !n.viewed)
        },
        markViewed(directory: string) {
          const [syncStore] = globalSync.child(directory)
          const ids = new Set(syncStore.session.map((s) => s.id))
          setStore("list", (n) => !!n.session && ids.has(n.session), "viewed", true)
        },
      },
    }
  },
})
