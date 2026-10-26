import type { ModelRef, SessionMessageUser } from "@opencode/client/promise"
import { createStore } from "solid-js/store"
import type { ServerSDK } from "@/runtime/server/client"

// A submitted prompt the timeline shows before the server admits it, with the agent and model it was sent with.
export type SessionMessageHandoff = {
  message: SessionMessageUser
  selection: { agent: string; model: ModelRef }
}

const MAX = 40

// Each prompt keeps its handoff until its own admission echo, so a second steer sent before the first is admitted
// leaves the first where it stands.
const [handoffs, setHandoffs] = createStore<Record<string, SessionMessageHandoff[] | undefined>>({})

const handoffOrder = new Map<string, true>()

export const setSessionMessageHandoff = (key: string, handoff: SessionMessageHandoff) => {
  handoffOrder.delete(key)
  handoffOrder.set(key, true)
  setHandoffs(key, (list = []) => [...list.filter((item) => item.message.id !== handoff.message.id), handoff])

  while (handoffOrder.size > MAX) {
    const first = handoffOrder.keys().next().value

    if (first === undefined) return
    handoffOrder.delete(first)
    setHandoffs(first, undefined)
  }
}

export const getSessionMessageHandoffs = (key: string) => handoffs[key] ?? []

export const clearSessionMessageHandoff = (key: string, messageID: string) => {
  const list = handoffs[key]?.filter((item) => item.message.id !== messageID)

  if (list?.length === handoffs[key]?.length) return

  if (list?.length) return setHandoffs(key, list)
  handoffOrder.delete(key)
  setHandoffs(key, undefined)
}

// Holds each of a session's handoffs until the server's admission echo, which follows the echoes of the switches it
// projects.
export function createSessionMessageHandoff(key: string, sessionID: string, event: ServerSDK["event"]) {
  const echoes = new Map<string, VoidFunction>()

  const release = (messageID: string) => {
    echoes.get(messageID)?.()
    echoes.delete(messageID)
  }

  return {
    set(handoff: SessionMessageHandoff) {
      release(handoff.message.id)
      setSessionMessageHandoff(key, handoff)
      echoes.set(
        handoff.message.id,
        event.on("session.inbox.enqueued", (item) => {
          if (item.data.sessionID !== sessionID || item.data.inboxID !== handoff.message.id) return
          release(handoff.message.id)
          clearSessionMessageHandoff(key, handoff.message.id)
        }),
      )
    },
    clear(messageID: string) {
      release(messageID)
      clearSessionMessageHandoff(key, messageID)
    },
  }
}
