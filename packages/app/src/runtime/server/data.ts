import type { Data } from "@opencode/client/solid"
import type { SessionInfo } from "@opencode/client/promise"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { uuid } from "@/runtime/persistence/uuid"

type SessionMutation = { readonly id: string; readonly type: "remove"; readonly sessionID: string }

export function createDesktopData(input: {
  createData: (session: { removing: (sessionID: string) => boolean }) => Data
  remove: (sessionID: string) => Promise<void>
}) {
  const mutation = createSessionMutations(input.remove)
  // Registered after the factory's listeners, so they observe a local removal before its deletion event settles it.
  const data = input.createData({ removing: mutation.removing })
  onCleanup(data.on("session.deleted", (event) => mutation.deleted(event.data.sessionID)))

  return {
    ...data,
    session: {
      ...data.session,
      list: () => mutation.apply(data.session.list()),
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
      const mutation = { id: uuid(), type: "remove" as const, sessionID }
      setStore("session", (current) => [...current, mutation])

      return Promise.resolve()
        .then(() => remove(sessionID))
        .catch((error) => {
          clear(mutation.id)
          throw error
        })
    },
    removing(sessionID: string) {
      return store.session.some((mutation) => mutation.sessionID === sessionID)
    },
    deleted(sessionID: string) {
      setStore("session", (current) => current.filter((mutation) => mutation.sessionID !== sessionID))
    },
  }
}
