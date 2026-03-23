import type { SelectedLineRange } from "@/context/file"
import type { Prompt } from "@/context/prompt"

type HandoffSession = {
  prompt: string
  draft?: Prompt
  files?: Record<string, SelectedLineRange | null>
}

const MAX = 40

const store = {
  session: new Map<string, HandoffSession>(),
  terminal: new Map<string, string[]>(),
}

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
  const prev = store.session.get(key) ?? { prompt: "" }
  touch(store.session, key, { ...prev, ...patch })
}

export const getSessionHandoff = (key: string) => store.session.get(key)

export const takeSessionDraft = (key: string) => {
  const prev = store.session.get(key)
  const draft = prev?.draft
  if (!prev || !draft) return

  touch(store.session, key, { ...prev, draft: undefined })
  return draft
}

export const setTerminalHandoff = (key: string, value: string[]) => {
  touch(store.terminal, key, value)
}

export const getTerminalHandoff = (key: string) => store.terminal.get(key)
