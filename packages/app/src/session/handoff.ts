import type { SelectedLineRange } from "@/workspaces/files/model"
import type { SessionMessageUser } from "@opencode-ai/client/promise"
import { createStore } from "solid-js/store"

type HandoffSession = {
  files: Record<string, SelectedLineRange | null>
  message?: SessionMessageUser
}

const MAX = 40

const store = {
  session: new Map<string, HandoffSession>(),
  terminal: new Map<string, string[]>(),
}
const [state, setState] = createStore({ messageRevision: 0 })

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
  setSessionHandoff(key, { message })
  setState("messageRevision", (value) => value + 1)
}

export const getSessionMessageHandoff = (key: string) => {
  void state.messageRevision
  return store.session.get(key)?.message
}

export const clearSessionMessageHandoff = (key: string, messageID: string) => {
  const value = store.session.get(key)
  if (value?.message?.id !== messageID) return
  touch(store.session, key, { ...value, message: undefined })
  setState("messageRevision", (revision) => revision + 1)
}

export const setTerminalHandoff = (key: string, value: string[]) => {
  touch(store.terminal, key, value)
}

export const getTerminalHandoff = (key: string) => store.terminal.get(key)
