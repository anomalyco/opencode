import type { SessionMessage } from "@opencode/schema/session-message"
import type { SessionMessageUser } from "@opencode/client/promise"
import { createStore } from "solid-js/store"

const MAX = 40

const [messages, setMessages] = createStore<Record<string, SessionMessageUser | undefined>>({})
const messageOrder = new Map<string, true>()

export const setSessionMessageHandoff = (key: string, message: SessionMessageUser) => {
  messageOrder.delete(key)
  messageOrder.set(key, true)
  setMessages(key, message)
  while (messageOrder.size > MAX) {
    const first = messageOrder.keys().next().value
    if (first === undefined) return
    messageOrder.delete(first)
    setMessages(first, undefined)
  }
}

export const getSessionMessageHandoff = (key: string) => messages[key]

export const clearSessionMessageHandoff = (key: string, messageID: SessionMessage.ID) => {
  if (messages[key]?.id !== messageID) return
  messageOrder.delete(key)
  setMessages(key, undefined)
}
