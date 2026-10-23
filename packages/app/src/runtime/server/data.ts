import type { Data } from "@opencode/client/solid"
import { ClientError, type SessionInfo } from "@opencode/client/promise"
import { Predicate } from "effect"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { uuid } from "@/runtime/persistence/uuid"
import { isSessionNotFoundError } from "./errors"

type SessionMutation = { readonly id: string; readonly type: "remove"; readonly sessionID: string }

export function createDesktopData(input: { data: Data; remove: (sessionID: string) => Promise<void> }) {
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
  const [store, setStore] = createStore<{ session: SessionMutation[] }>({ session: [] })

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
          const cause = error instanceof Error ? error.cause : undefined

          if (
            !(error instanceof ClientError) &&
            (!Predicate.isObject(cause) || !("status" in cause) || cause.status === 404) &&
            isSessionNotFoundError(error, sessionID)
          )
            return
          clear(mutation.id)
          throw error
        })
    },
    deleted(sessionID: string) {
      setStore("session", (current) => current.filter((mutation) => mutation.sessionID !== sessionID))
    },
  }
}
