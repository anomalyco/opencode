import type { Data } from "@opencode/client/solid"
import { isSessionNotFoundError, type OpenCodeEvent, type SessionInfo } from "@opencode/client/promise"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { uuid } from "@opencode/util/uuid"

type SessionMutation = { readonly id: string; readonly type: "remove"; readonly sessionID: string }

type SendRecency = { readonly sentAt: number; readonly serverUpdatedAt: number }

type RenameRecency = { readonly at: number; previous?: number }

const REMOVED_SESSION_LIMIT = 512

// A completed execution refreshes the session's server record so the list follows the server's `time.updated`.
const SESSION_EXECUTION_ENDED = [
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
] satisfies OpenCodeEvent["type"][]

export function createDesktopData(input: { data: Data; remove: (sessionID: string) => Promise<void> }) {
  const mutation = createSessionMutations(input.remove)
  const recency = createSessionRecency()
  const [version, setVersion] = createStore({ value: 0 })
  const changed = () => setVersion("value", (value) => value + 1)
  const refresh = createSessionRefresh((sessionID) => input.data.session.sync(sessionID))

  onCleanup(
    input.data.on("session.deleted", (event) => {
      recency.forget(event.data.sessionID)
      changed()
      mutation.deleted(event.data.sessionID)
    }),
  )
  // Renaming advances `time.updated` server-side. Remember the value shown before the rename so a refetch of the
  // renamed record cannot promote the session; a newer record becomes the floor so stale refetches cannot demote it.
  onCleanup(
    input.data.on("session.renamed", (event) => {
      recency.renamed(event.data.sessionID, session(event.data.sessionID), event.created)
      changed()
    }),
  )
  // The client already invalidates the session at execution end. Coalesce the follow-up read so overlapping ends
  // share one refresh; the sync machinery keeps an older response from committing after a newer one.
  SESSION_EXECUTION_ENDED.forEach((type) =>
    onCleanup(
      input.data.on(type, (event) => {
        queueMicrotask(() => {
          // Child sessions never appear in recency lists. An unknown record may be a root, so refresh it.
          if (input.data.session.get(event.data.sessionID)?.parentID) return
          refresh(event.data.sessionID)
        })
      }),
    ),
  )

  function session(sessionID: string) {
    return input.data.session.get(sessionID) ?? input.data.session.list().find((item) => item.id === sessionID)
  }

  const apply = (sessions: readonly SessionInfo[]) => {
    version.value

    const result = recency.apply(mutation.apply(sessions))

    // A record can settle a send or a rename while a memo reads it. Rerun the other readers after this computation
    // so every list converges on the same recency in the next tick.
    if (recency.takeMutated()) queueMicrotask(changed)

    return result
  }

  return {
    ...input.data,
    session: {
      ...input.data.session,
      list: () => apply(input.data.session.list()),
      apply,
      // The composer calls this once the server accepts a prompt, including a queued one.
      acceptSend: (sessionID: string) => {
        recency.acceptSend(sessionID, session(sessionID), Date.now())
        changed()
      },
      remove: (sessionID: string) =>
        mutation.remove(sessionID).then(() => {
          recency.forget(sessionID)
          changed()
          input.data.session.forget(sessionID)
        }),
    },
  }
}

export function createSessionRecency() {
  const sends = new Map<string, SendRecency>()
  const renames = new Map<string, RenameRecency>()
  // The newest server value a send's catch-up has taught us. Stale list fetches must not drop below it.
  const floors = new Map<string, number>()
  // Raw values already rendered. A rename with no live record can still recover its pre-rename value from one.
  const observed = new Map<string, number>()
  let mutated = false

  const grow = (map: Map<string, number>, sessionID: string, value: number) => {
    if (value <= (map.get(sessionID) ?? Number.NEGATIVE_INFINITY)) return
    map.set(sessionID, value)
    mutated = true
  }

  const observe = (sessionID: string, value: number) => {
    if (value <= (observed.get(sessionID) ?? Number.NEGATIVE_INFINITY)) return
    observed.set(sessionID, value)
  }

  return {
    acceptSend(sessionID: string, info: SessionInfo | undefined, sentAt: number) {
      const previous = sends.get(sessionID)
      const renamedAt = renames.get(sessionID)?.at ?? 0
      sends.set(sessionID, {
        sentAt,
        // Keep the highest server value known before this send. A pending rename is already on the server, so a
        // stale fetch at the rename time must not be mistaken for the send catching up.
        serverUpdatedAt: Math.max(
          previous?.serverUpdatedAt ?? 0,
          info?.time.updated ?? 0,
          renamedAt,
          floors.get(sessionID) ?? 0,
        ),
      })

      if (info) observe(sessionID, info.time.updated)
    },
    renamed(sessionID: string, info: SessionInfo | undefined, at: number) {
      const send = sends.get(sessionID)
      const seen = observed.get(sessionID)
      const seenPrior = seen !== undefined && seen < at ? seen : undefined
      // A record at the rename time is already renamed, so it cannot supply the pre-rename value.
      const infoPrior = info !== undefined && info.time.updated !== at ? info.time.updated : undefined

      const prior =
        seenPrior === undefined
          ? infoPrior
          : infoPrior === undefined
            ? seenPrior
            : Math.max(seenPrior, infoPrior)

      const previous = Math.max(
        renames.get(sessionID)?.previous ?? Number.NEGATIVE_INFINITY,
        prior ?? Number.NEGATIVE_INFINITY,
        send?.sentAt ?? Number.NEGATIVE_INFINITY,
        floors.get(sessionID) ?? Number.NEGATIVE_INFINITY,
      )

      renames.set(sessionID, {
        at,
        previous: previous === Number.NEGATIVE_INFINITY ? undefined : previous,
      })
    },
    apply(infos: readonly SessionInfo[]) {
      mutated = false
      const pending = new Map<string, { newest: number; settled: number }>()

      // Settle state from the whole batch first, so [stale, fresh] and [fresh, stale] compute the same values.
      for (const info of infos) {
        const rename = renames.get(info.id)

        if (rename) {
          if (info.time.updated !== rename.at) observe(info.id, info.time.updated)
        } else observe(info.id, info.time.updated)

        if (!sends.has(info.id) && !rename) continue

        const settled = pending.get(info.id) ?? {
          newest: Number.NEGATIVE_INFINITY,
          settled: rename?.previous ?? Number.NEGATIVE_INFINITY,
        }

        settled.newest = Math.max(settled.newest, info.time.updated)

        if (info.time.updated !== rename?.at)
          settled.settled = Math.max(settled.settled, info.time.updated)
        pending.set(info.id, settled)
      }

      pending.forEach((settled, sessionID) => {
        const send = sends.get(sessionID)

        if (send && settled.newest > send.serverUpdatedAt) {
          sends.delete(sessionID)
          mutated = true
          grow(floors, sessionID, settled.newest)
        }

        const rename = renames.get(sessionID)

        if (rename && settled.settled > (rename.previous ?? Number.NEGATIVE_INFINITY)) {
          rename.previous = settled.settled
          mutated = true
        }
      })

      return infos.map((info) => {
        const send = sends.get(info.id)

        if (send) return withTime(info, Math.max(info.time.updated, send.sentAt, floors.get(info.id) ?? 0))

        const rename = renames.get(info.id)

        const updated = rename
          ? info.time.updated <= rename.at
            ? (rename.previous ?? Math.min(info.time.created, rename.at))
            : Math.max(info.time.updated, rename.previous ?? 0)
          : info.time.updated

        return withTime(info, Math.max(updated, floors.get(info.id) ?? 0))
      })
    },
    // True when apply settled a send or raised a floor, so the caller can rerun other readers once.
    takeMutated() {
      const value = mutated
      mutated = false

      return value
    },
    forget(sessionID: string) {
      sends.delete(sessionID)
      renames.delete(sessionID)
      floors.delete(sessionID)
      observed.delete(sessionID)
    },
  }
}

function withTime(info: SessionInfo, updated: number) {
  return updated === info.time.updated ? info : { ...info, time: { ...info.time, updated } }
}

// One refresh per session can run at a time; another end while it runs queues exactly one follow-up refresh.
export function createSessionRefresh(refresh: (sessionID: string) => Promise<void>) {
  const active = new Set<string>()
  const queued = new Set<string>()

  const run = (sessionID: string): Promise<void> => {
    active.add(sessionID)

    return refresh(sessionID)
      .catch(() => undefined)
      .finally(() => {
        active.delete(sessionID)

        if (queued.delete(sessionID)) void run(sessionID)
      })
  }

  return (sessionID: string): Promise<void> => {
    if (active.has(sessionID)) {
      queued.add(sessionID)

      return Promise.resolve()
    }

    return run(sessionID)
  }
}

export function createSessionMutations(remove: (sessionID: string) => Promise<void>) {
  const [store, setStore] = createStore<{ session: SessionMutation[] }>({ session: [] })

  const clear = (id: string) => {
    setStore("session", (current) => current.filter((mutation) => mutation.id !== id))
  }

  const append = (current: readonly SessionMutation[], next: SessionMutation) =>
    [...current.filter((mutation) => mutation.sessionID !== next.sessionID), next].slice(-REMOVED_SESSION_LIMIT)

  return {
    apply(sessions: readonly SessionInfo[]) {
      const removed = new Set(
        store.session.flatMap((mutation) => (mutation.type === "remove" ? [mutation.sessionID] : [])),
      )

      return removed.size === 0 ? [...sessions] : sessions.filter((session) => !removed.has(session.id))
    },
    remove(sessionID: string) {
      const mutation = { id: uuid(), type: "remove" as const, sessionID }
      setStore("session", (current) => append(current, mutation))

      return Promise.resolve()
        .then(() => remove(sessionID))
        .catch((error) => {
          if (isSessionNotFoundError(error)) return

          clear(mutation.id)
          throw error
        })
    },
    // Keep the deleted session hidden: cached lists such as the Home index still hold it until they refetch.
    deleted(sessionID: string) {
      setStore("session", (current) => append(current, { id: uuid(), type: "remove", sessionID }))
    },
  }
}
