import type { ModelRef, SessionMessageUser } from "@opencode/client/promise"
import { createStore } from "solid-js/store"
import type { ServerSDK } from "@/runtime/server/client"

// A submitted prompt the timeline shows before the server admits it, with the agent and model it was sent with.
export type SessionMessageHandoff = {
  message: SessionMessageUser
  selection: { agent: string; model: ModelRef }
}

const MAX = 40

const [handoffs, setHandoffs] = createStore<Record<string, SessionMessageHandoff | undefined>>({})

const handoffOrder = new Map<string, true>()

export const setSessionMessageHandoff = (key: string, handoff: SessionMessageHandoff) => {
  handoffOrder.delete(key)
  handoffOrder.set(key, true)
  setHandoffs(key, handoff)

  while (handoffOrder.size > MAX) {
    const first = handoffOrder.keys().next().value

    if (first === undefined) return
    handoffOrder.delete(first)
    setHandoffs(first, undefined)
  }
}

export const getSessionMessageHandoff = (key: string) => handoffs[key]

export const clearSessionMessageHandoff = (key: string, messageID: string) => {
  if (handoffs[key]?.message.id !== messageID) return
  handoffOrder.delete(key)
  setHandoffs(key, undefined)
}

// Holds a session's handoff until the server's admission echo, which follows the echoes of the switches it projects.
export function createSessionMessageHandoff(key: string, sessionID: string, event: ServerSDK["event"]) {
  let unsubscribe: VoidFunction | undefined

  return {
    set(handoff: SessionMessageHandoff) {
      unsubscribe?.()
      setSessionMessageHandoff(key, handoff)
      unsubscribe = event.on("session.inbox.enqueued", (item) => {
        if (item.data.sessionID !== sessionID || item.data.inboxID !== handoff.message.id) return
        unsubscribe?.()
        unsubscribe = undefined
        clearSessionMessageHandoff(key, handoff.message.id)
      })
    },
    clear(messageID: string) {
      unsubscribe?.()
      unsubscribe = undefined
      clearSessionMessageHandoff(key, messageID)
    },
  }
}
