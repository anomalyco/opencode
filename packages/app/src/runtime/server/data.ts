import type { Data } from "@opencode/client/solid"
import { isSessionNotFoundError, type OpenCodeEvent, type SessionInfo } from "@opencode/client/promise"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { uuid } from "@opencode/util/uuid"

type SessionMutation = { readonly id: string; readonly type: "remove"; readonly sessionID: string }

type SendRecency = { readonly sentAt: number; readonly serverUpdatedAt: number }

type RenameRecency = { readonly ats: Set<number>; readonly latest: number; previous?: number }

type ObservedRecency = { readonly values: readonly number[] }

const REMOVED_SESSION_LIMIT = 512

// Recency bookkeeping is per session and only needed for lists; bound it like the removed-session set.
const RECENCY_SESSION_LIMIT = 512

const OBSERVED_VALUE_LIMIT = 4

// Times returned by apply() are projections. Remember their raw server value so remember() never stores the bump.
const syntheticTimes = new WeakMap<SessionInfo["time"], number>()

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
        // Shutdown interruptions do not advance the projected idle/updated markers.
        if (event.type === "session.execution.interrupted" && event.data.reason === "shutdown") return
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
      remember(info: SessionInfo) {
        const raw = syntheticTimes.get(info.time)

        input.data.session.remember(raw === undefined ? info : { ...info, time: { ...info.time, updated: raw } })
      },
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
  // Raw non-rename values already rendered, newest first. A rename with no live record recovers its pre-rename
  // value from here even when a refetched rename record landed before the SSE event.
  const observed = new Map<string, ObservedRecency>()
  let mutated = false

  const keep = <Key, Value>(map: Map<Key, Value>, key: Key, value: Value) => {
    map.delete(key)
    map.set(key, value)

    if (map.size <= RECENCY_SESSION_LIMIT) return

    const oldest = map.keys().next().value

    if (oldest !== undefined) map.delete(oldest)
  }

  const grow = (map: Map<string, number>, sessionID: string, value: number) => {
    if (value <= (map.get(sessionID) ?? Number.NEGATIVE_INFINITY)) return
    keep(map, sessionID, value)
    mutated = true
  }

  const observe = (sessionID: string, value: number) => {
    if (renames.get(sessionID)?.ats.has(value)) return

    const values = observed.get(sessionID)?.values ?? []

    if (values.includes(value)) return

    keep(observed, sessionID, {
      values: [...values, value].sort((a, b) => b - a).slice(0, OBSERVED_VALUE_LIMIT),
    })
  }

  const observedPrior = (sessionID: string) => observed.get(sessionID)?.values[0]

  return {
    acceptSend(sessionID: string, info: SessionInfo | undefined, sentAt: number) {
      const previous = sends.get(sessionID)
      const renamedAt = renames.get(sessionID)?.latest ?? 0
      const updated = info ? rawTime(info) : 0
      keep(sends, sessionID, {
        sentAt,
        // Keep the highest server value known before this send. A pending rename is already on the server, so a
        // stale fetch at the rename time must not be mistaken for the send catching up.
        serverUpdatedAt: Math.max(previous?.serverUpdatedAt ?? 0, updated, renamedAt, floors.get(sessionID) ?? 0),
      })

      if (info) observe(sessionID, updated)
    },
    renamed(sessionID: string, info: SessionInfo | undefined, at: number) {
      const existing = renames.get(sessionID)
      const ats = new Set(existing?.ats ?? [])
      ats.add(at)

      if (ats.size > RECENCY_SESSION_LIMIT) {
        const oldest = ats.values().next().value

        if (oldest !== undefined) ats.delete(oldest)
      }

      // The rename time itself is not activity. Drop it, and every earlier rename time, from the observed values.
      const values = (observed.get(sessionID)?.values ?? []).filter((value) => !ats.has(value))

      if (values.length > 0) keep(observed, sessionID, { values })
      else observed.delete(sessionID)

      const infoUpdated = info ? rawTime(info) : undefined
      const infoPrior = infoUpdated !== undefined && !ats.has(infoUpdated) ? infoUpdated : undefined

      const previous = Math.max(
        existing?.previous ?? Number.NEGATIVE_INFINITY,
        infoPrior ?? Number.NEGATIVE_INFINITY,
        values[0] ?? Number.NEGATIVE_INFINITY,
        floors.get(sessionID) ?? Number.NEGATIVE_INFINITY,
      )

      keep(renames, sessionID, {
        ats,
        latest: Math.max(existing?.latest ?? 0, at),
        previous: previous === Number.NEGATIVE_INFINITY ? undefined : previous,
      })
    },
    apply(infos: readonly SessionInfo[]) {
      mutated = false
      const pending = new Map<string, { newest: number; settled: number }>()

      // Settle state from the whole batch first, so [stale, fresh] and [fresh, stale] compute the same values.
      for (const info of infos) {
        const rename = renames.get(info.id)
        const updated = rawTime(info)
        const renameTime = rename?.ats.has(updated) ?? false

        if (!renameTime) observe(info.id, updated)

        if (!sends.has(info.id) && !rename) continue

        const settled = pending.get(info.id) ?? {
          newest: Number.NEGATIVE_INFINITY,
          settled: rename?.previous ?? Number.NEGATIVE_INFINITY,
        }

        if (!renameTime) {
          settled.newest = Math.max(settled.newest, updated)
          settled.settled = Math.max(settled.settled, updated)
        }

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
        const updated = rawTime(info)

        if (send) return withTime(info, Math.max(updated, send.sentAt, floors.get(info.id) ?? 0))

        const rename = renames.get(info.id)

        const projected = rename
          ? rename.ats.has(updated)
            ? (rename.previous ?? observedPrior(info.id) ?? Math.min(info.time.created, rename.latest))
            : Math.max(updated, rename.previous ?? 0)
          : updated

        return withTime(info, Math.max(projected, floors.get(info.id) ?? 0))
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

function rawTime(info: SessionInfo) {
  return syntheticTimes.get(info.time) ?? info.time.updated
}

function withTime(info: SessionInfo, updated: number) {
  const raw = rawTime(info)

  if (updated === raw && updated === info.time.updated) return info

  const time = { ...info.time, updated }
  syntheticTimes.set(time, raw)

  return { ...info, time }
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
