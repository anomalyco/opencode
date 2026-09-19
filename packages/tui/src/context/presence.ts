import { isClientNotFoundError } from "@opencode/client"
import { createEffect, createMemo, onCleanup } from "solid-js"
import { useClient } from "./client"
import { useEvent } from "./event"
import { useRoute } from "./route"
import { useSessionTabs } from "./session-tabs"

const HEARTBEAT_MS = 15_000

export function useClientPresence() {
  const client = useClient()
  const event = useEvent()
  const route = useRoute()
  const sessionTabs = useSessionTabs()
  let id: string | undefined

  const sessions = createMemo(() => {
    const ids = sessionTabs.tabs().map((tab) => tab.sessionID).filter((sessionID) => sessionID.startsWith("ses"))
    if (route.data.type === "session" && route.data.sessionID.startsWith("ses") && !ids.includes(route.data.sessionID)) {
      return [...ids, route.data.sessionID]
    }
    return ids
  })

  createEffect(() => {
    if (client.connection.status() !== "connected") {
      if (!id) return
      const current = id
      id = undefined
      void client.api.client.remove({ clientID: current }).catch(() => undefined)
      return
    }

    const displayed = sessions()
    const focused = sessionTabs.focused()
    let stopped = false
    const push = async () => {
      if (stopped) return
      const payload = { kind: "tui" as const, sessions: displayed, focused, pid: process.pid }
      if (id) {
        try {
          await client.api.client.update({ clientID: id, sessions: displayed, focused })
          return
        } catch (error) {
          if (!isClientNotFoundError(error)) throw error
          id = undefined
        }
      }
      const created = await client.api.client.register(payload)
      if (stopped) {
        await client.api.client.remove({ clientID: created.id }).catch(() => undefined)
        return
      }
      id = created.id
    }

    void push().catch(() => undefined)
    const timer = setInterval(() => void push().catch(() => undefined), HEARTBEAT_MS)
    onCleanup(() => {
      stopped = true
      clearInterval(timer)
    })
  })

  createEffect(() => {
    const unsub = event.on("client.activate", (evt) => {
      if (!id || evt.data.clientID !== id) return
      route.navigate({ type: "session", sessionID: evt.data.sessionID })
    })
    onCleanup(unsub)
  })

  onCleanup(() => {
    if (!id) return
    const current = id
    id = undefined
    void client.api.client.remove({ clientID: current }).catch(() => undefined)
  })
}
