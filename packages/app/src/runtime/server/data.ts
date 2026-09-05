import type { Data } from "@opencode-ai/client/solid"
import type { SessionInfo } from "@opencode-ai/client/promise"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

type SessionMutation = { readonly id: string; readonly type: "remove"; readonly sessionID: string }

export function createDesktopData<T extends Data>(input: { data: T; remove: (sessionID: string) => Promise<void> }) {
  const mutation = createSessionMutations(input.remove)
  onCleanup(input.data.on("session.deleted", (event) => mutation.deleted(event.data.sessionID)))

  return {
    ...input.data,
    session: {
      ...input.data.session,
      list: () => mutation.apply(input.data.session.list()),
      apply: mutation.apply,
      remove: mutation.remove,
    },
  }
}

export function createSessionMutations(remove: (sessionID: string) => Promise<void>) {
  const [store, setStore] = createStore({ session: [] as SessionMutation[] })

  const clear = (id: string) => {
    setStore("session", (current) => current.filter((mutation) => mutation.id !== id))
  }

  return {
    apply(sessions: readonly SessionInfo[]) {
      const removed = new Set(
        store.session.flatMap((mutation) => (mutation.type === "remove" ? [mutation.sessionID] : [])),
      )
      return removed.size === 0 ? [...sessions] : sessions.filter((session) => !removed.has(session.id))
    },
    remove(sessionID: string) {
      const mutation = { id: crypto.randomUUID(), type: "remove" as const, sessionID }
      setStore("session", (current) => [...current, mutation])
      return Promise.resolve()
        .then(() => remove(sessionID))
        .catch((error) => {
          clear(mutation.id)
          throw error
        })
    },
    deleted(sessionID: string) {
      setStore("session", (current) => current.filter((mutation) => mutation.sessionID !== sessionID))
    },
  }
}
