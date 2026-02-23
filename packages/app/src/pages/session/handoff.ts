import type { FileSelection, SelectedLineRange } from "@/context/file"

type HandoffSession = {
  prompt: string
  files: Record<string, SelectedLineRange | null>
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
  const prev = store.session.get(key) ?? { prompt: "", files: {} }
  touch(store.session, key, { ...prev, ...patch })
}

export const getSessionHandoff = (key: string) => store.session.get(key)

export const setTerminalHandoff = (key: string, value: string[]) => {
  touch(store.terminal, key, value)
}

export const getTerminalHandoff = (key: string) => store.terminal.get(key)

export type QuickEditHandoff = {
  path: string
  selection: FileSelection
  instruction: string
  preview?: string
}

const MAX_PENDING_QUICK_EDIT = 20
const pendingQuickEdit: QuickEditHandoff[] = []

export const setQuickEditHandoff = (data: QuickEditHandoff) => {
  pendingQuickEdit.push(data)
  while (pendingQuickEdit.length > MAX_PENDING_QUICK_EDIT) {
    pendingQuickEdit.shift()
  }
}

export const consumeQuickEditHandoff = () => {
  return pendingQuickEdit.shift()
}
