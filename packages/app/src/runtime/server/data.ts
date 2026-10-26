import type { Data } from "@opencode/client/solid"
import type { OpenCodeEvent, SessionInfo } from "@opencode/client/promise"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { uuid } from "@/runtime/persistence/uuid"

type SessionMutation = { readonly id: string; readonly type: "remove"; readonly sessionID: string }

// The events on which the server advances a session's `time.updated` to the event's time.
const SESSION_ACTIVITY = [
  "session.inbox.enqueued",
  "session.step.started",
  "session.step.ended",
  "session.step.failed",
  "session.renamed",
  "session.agent.selected",
  "session.model.selected",
  "session.metadata.updated",
  "session.permissions",
  "session.moved",
  "session.archived",
  "session.unarchived",
  "session.revert.staged",
  "session.revert.cleared",
  "session.revert.committed",
] satisfies OpenCodeEvent["type"][]

export function createDesktopData(input: { data: Data; remove: (sessionID: string) => Promise<void> }) {
  const mutation = createSessionMutations(input.remove)
  const [activity, setActivity] = createStore<Record<string, number>>({})
  onCleanup(input.data.on("session.deleted", (event) => mutation.deleted(event.data.sessionID)))

  // Lists loaded earlier (the Home index, the live store, search results) learn each session's newer
  // `time.updated` from its events, so they rank sessions in the server's order without reloading.
  SESSION_ACTIVITY.forEach((type) =>
    onCleanup(
      input.data.on(type, (event) => {
        if (event.created > (activity[event.data.sessionID] ?? 0)) setActivity(event.data.sessionID, event.created)
      }),
    ),
  )

  const apply = (sessions: readonly SessionInfo[]) =>
    mutation.apply(sessions).map((session) => {
      const updated = activity[session.id]

      return updated && updated > session.time.updated ? { ...session, time: { ...session.time, updated } } : session
    })

  return {
    ...input.data,
    session: {
      ...input.data.session,
      list: () => apply(input.data.session.list()),
      apply,
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
          clear(mutation.id)
          throw error
        })
    },
    // Keep the deleted session hidden: cached lists such as the Home index still hold it until they refetch.
    deleted(sessionID: string) {
      setStore("session", (current) => [
        ...current.filter((mutation) => mutation.sessionID !== sessionID),
        { id: uuid(), type: "remove", sessionID },
      ])
    },
  }
}
