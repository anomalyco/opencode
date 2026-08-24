import type { SelectedLineRange } from "@/workspaces/files/model"
import type { SessionMessageUser } from "@opencode-ai/client/promise"
import { createStore } from "solid-js/store"

type HandoffSession = {
  files: Record<string, SelectedLineRange | null>
}

const MAX = 40

const store = {
  session: new Map<string, HandoffSession>(),
  terminal: new Map<string, string[]>(),
}
const [messages, setMessages] = createStore<Record<string, SessionMessageUser | undefined>>({})
const messageOrder = new Map<string, true>()

const touch = <K, V>(map: Map<K, V>, key: K, value: V) => {
  map.delete(key)
  map.set(key, value)
  while (map.size > MAX) {
    const first = map.keys().next().value
    if (first === undefined) return
    map.delete(first)
  }
}

export const setSessionHandoff = (key: string, patch: Partial<HandoffSession>) => {
  const prev = store.session.get(key) ?? { files: {} }
  touch(store.session, key, { ...prev, ...patch })
}

export const getSessionHandoff = (key: string) => store.session.get(key)

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

export const clearSessionMessageHandoff = (key: string, messageID: string) => {
  if (messages[key]?.id !== messageID) return
  messageOrder.delete(key)
  setMessages(key, undefined)
}

export const setTerminalHandoff = (key: string, value: string[]) => {
  touch(store.terminal, key, value)
}

export const getTerminalHandoff = (key: string) => store.terminal.get(key)
