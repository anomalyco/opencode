import type { Data } from "@opencode/client/solid"
import { isSessionNotFoundError, type OpenCodeEvent, type SessionInfo } from "@opencode/client/promise"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { uuid } from "@opencode/util/uuid"

type SessionMutation = { readonly id: string; readonly type: "remove"; readonly sessionID: string }

type SendRecency = { readonly sentAt: number; readonly serverUpdatedAt: number }

const REMOVED_SESSION_LIMIT = 512

// Recency bookkeeping is per session and only needed for lists; bound it like the removed-session set.
const RECENCY_SESSION_LIMIT = 512

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

  const refresh = createSessionRefresh((sessionID) => {
    input.data.session.invalidate(sessionID)

    return input.data.session.sync(sessionID)
  })

  onCleanup(
    input.data.on("session.deleted", (event) => {
      recency.forget(event.data.sessionID)
      changed()
      mutation.deleted(event.data.sessionID)
    }),
  )
  // The SDK invalidates and syncs loaded sessions on execution end. Desktop also needs a fresh record for roots
  // that only appear in an index that does not reload itself at run end (Home, Inbox, the project sidebars).
  // Coalesce those reads across overlapping ends.
  SESSION_EXECUTION_ENDED.forEach((type) =>
    onCleanup(
      input.data.on(type, (event) => {
        // Shutdown interruptions do not advance the projected idle/updated markers.
        if (event.type === "session.execution.interrupted" && event.data.reason === "shutdown") return
        queueMicrotask(() => {
          if (input.data.session.get(event.data.sessionID) || !recency.wasListedRoot(event.data.sessionID)) return
          refresh(event.data.sessionID)
        })
      }),
    ),
  )

  function session(sessionID: string) {
    return input.data.session.get(sessionID) ?? input.data.session.list().find((item) => item.id === sessionID)
  }

  // `reloads` marks a list that reloads its own snapshot at run end, so its roots need no per-session refresh.
  const apply = (sessions: readonly SessionInfo[], options?: { reloads: true }) => {
    version.value

    const result = recency.apply(mutation.apply(sessions), !options?.reloads)

    // A record can settle a send while a memo reads it. Rerun the other readers after this computation
    // so every list converges on the same recency in the next tick.
    if (recency.takeMutated()) queueMicrotask(changed)

    return result
  }

  return {
    ...input.data,
    session: {
      ...input.data.session,
      list: () => {
        version.value

        return mutation.apply(input.data.session.list()).map(recency.project)
      },
      // Index consumers merge the raw server snapshots before applying pending sends.
      known: input.data.session.list,
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
  // The newest server value a send's catch-up has taught us. Stale list fetches must not drop below it.
  const floors = new Map<string, number>()
  // The newest server time any list row has shown. The live record lags it after a rename, model or agent change,
  // step or metadata update, so a send starts from it. Only a send reads it, so nothing reorders on it.
  const latest = new Map<string, number>()
  // Run-end refresh eligibility comes from reads of lists that do not reload themselves.
  const listedRoots = new Map<string, true>()
  let mutated = false

  const keep = <Key, Value>(map: Map<Key, Value>, key: Key, value: Value) => {
    map.delete(key)
    map.set(key, value)

    if (map.size <= RECENCY_SESSION_LIMIT) return

    const oldest = map.keys().next().value

    if (oldest !== undefined) map.delete(oldest)
  }

  const grow = (map: Map<string, number>, sessionID: string, value: number) => {
    if (value <= (map.get(sessionID) ?? Number.NEGATIVE_INFINITY)) return false
    keep(map, sessionID, value)

    return true
  }

  // Reading live metadata for status must not settle a send or change another list's ordering.
  function project(info: SessionInfo) {
    const send = sends.get(info.id)
    const raw = rawTime(info)
    const updated = Math.max(raw, floors.get(info.id) ?? 0)

    grow(latest, info.id, raw)

    return withTime(info, send ? Math.max(updated, send.sentAt) : updated)
  }

  return {
    project,
    wasListedRoot: (sessionID: string) => listedRoots.has(sessionID),
    acceptSend(sessionID: string, info: SessionInfo | undefined, sentAt: number) {
      keep(sends, sessionID, {
        sentAt,
        // Keep the highest server value known before this send; only a newer server record settles it.
        serverUpdatedAt: Math.max(
          sends.get(sessionID)?.serverUpdatedAt ?? 0,
          info ? rawTime(info) : 0,
          floors.get(sessionID) ?? 0,
          latest.get(sessionID) ?? 0,
        ),
      })
    },
    apply(infos: readonly SessionInfo[], listed = true) {
      mutated = false
      const newest = new Map<string, number>()

      // Settle from the whole batch first, so [stale, fresh] and [fresh, stale] compute the same values.
      for (const [index, info] of infos.entries()) {
        if (listed && index < RECENCY_SESSION_LIMIT && !info.parentID) keep(listedRoots, info.id, true)

        if (!sends.has(info.id)) continue

        newest.set(info.id, Math.max(newest.get(info.id) ?? Number.NEGATIVE_INFINITY, rawTime(info)))
      }

      newest.forEach((updated, sessionID) => {
        const send = sends.get(sessionID)

        if (!send || updated <= send.serverUpdatedAt) return

        sends.delete(sessionID)
        mutated = true
        grow(floors, sessionID, updated)
      })

      return infos.map(project)
    },
    // True when apply settled a send or raised a floor, so the caller can rerun other readers once.
    takeMutated() {
      const value = mutated
      mutated = false

      return value
    },
    forget(sessionID: string) {
      sends.delete(sessionID)
      floors.delete(sessionID)
      latest.delete(sessionID)
      listedRoots.delete(sessionID)
    },
  }
}

/** The server's `time.updated` behind a row `apply` or `list` may have projected. Copy it when cloning a row's time. */
export function rawTime(info: SessionInfo) {
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
