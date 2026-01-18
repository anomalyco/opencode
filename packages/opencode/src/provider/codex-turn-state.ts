import { AsyncLocalStorage } from "node:async_hooks"

type TurnStateStore = {
  codexTurnState?: string
}

const storage = new AsyncLocalStorage<TurnStateStore>()

export const CodexTurnState = {
  run<T>(fn: () => T): T {
    return storage.run({}, fn)
  },
  get(): TurnStateStore | undefined {
    return storage.getStore()
  },
  set(value: string) {
    const store = storage.getStore()
    if (!store) return
    store.codexTurnState = value
  },
}
