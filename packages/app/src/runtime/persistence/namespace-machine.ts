export const NAMESPACE_FLUSH_DELAY_MS = 100

// Retries after failed batches double the flush delay up to 2^8 × 100 ms (about 26 s).
export const NAMESPACE_RETRY_MAX_EXPONENT = 8

export type NamespaceRemote = { readonly value: string | null; readonly revision: number }

// One key's write lifecycle. A local write is `dirty` until a batch carries it and `inflight` until the host acks that
// batch. While it is either, nothing external may replace it: the newest external change waits in `deferred` and wins
// after the ack only if the host applied it later.
export type NamespaceEntry =
  | { readonly status: "synced"; readonly value: string | null; readonly revision: number }
  | { readonly status: "dirty"; readonly value: string | null; readonly deferred: NamespaceRemote | undefined }
  | {
      readonly status: "inflight"
      readonly value: string | null
      readonly batch: number
      readonly deferred: NamespaceRemote | undefined
    }

// The namespace's load lifecycle. `floor` is the revision the snapshot (or a clear) reflected for every key, `batch` the
// id of the last batch cut, and `failures` the consecutive failed batches that set the retry backoff. A flush timer is
// armed exactly while some entry is `dirty`.
export type NamespaceState = {
  readonly status: "unloaded" | "loading" | "loaded"
  readonly entries: ReadonlyMap<string, NamespaceEntry>
  readonly floor: number
  readonly batch: number
  readonly failures: number
}

export type NamespaceEvent =
  | { readonly type: "load" }
  | { readonly type: "load.succeeded"; readonly items: Readonly<Record<string, string>>; readonly revision: number }
  | { readonly type: "load.failed" }
  | { readonly type: "write"; readonly key: string; readonly value: string | null }
  | { readonly type: "flush" }
  | { readonly type: "batch.succeeded"; readonly batch: number; readonly revision: number }
  | { readonly type: "batch.failed"; readonly batch: number }
  | {
      readonly type: "remote"
      readonly insert: Readonly<Record<string, string>>
      readonly remove: readonly string[]
      readonly revision: number
    }
  | { readonly type: "clear" }

export type NamespaceEffect =
  | { readonly type: "load" }
  | {
      readonly type: "send"
      readonly batch: number
      readonly insert: Record<string, string>
      readonly remove: string[]
    }
  | { readonly type: "timer.arm"; readonly delayMs: number }
  | { readonly type: "timer.cancel" }

export type NamespaceTransition = {
  readonly state: NamespaceState
  readonly effects: readonly NamespaceEffect[]
}

type Dirty = Extract<NamespaceEntry, { status: "dirty" }>

type Inflight = Extract<NamespaceEntry, { status: "inflight" }>

export const INITIAL_NAMESPACE_STATE: NamespaceState = {
  status: "unloaded",
  entries: new Map(),
  floor: -1,
  batch: 0,
  failures: 0,
}

export function transitionNamespace(state: NamespaceState, event: NamespaceEvent): NamespaceTransition {
  if (event.type === "load") {
    if (state.status !== "unloaded") return unchanged(state)

    return changed({ ...state, status: "loading" }, [{ type: "load" }])
  }

  // A clear while loading already settled the namespace, so a late snapshot cannot bring cleared keys back.
  if (event.type === "load.succeeded") {
    if (state.status !== "loading") return unchanged(state)

    return changed({
      ...state,
      status: "loaded",
      entries: snapshot(state.entries, event.items, event.revision),
      floor: event.revision,
    })
  }

  // Readers waiting on this load see what memory holds; the next read loads again.
  if (event.type === "load.failed") {
    if (state.status !== "loading") return unchanged(state)

    return changed({ ...state, status: "unloaded" })
  }

  if (event.type === "write") {
    const previous = state.entries.get(event.key)
    const deferred = previous?.status === "synced" ? undefined : previous?.deferred
    const entries = new Map(state.entries).set(event.key, { status: "dirty", value: event.value, deferred })

    return changed(
      { ...state, entries },
      queued(state.entries) ? [] : [{ type: "timer.arm", delayMs: retryDelay(state.failures) }],
    )
  }

  // Batches go out as soon as they are cut, never behind an earlier reply, so a flush on pagehide is on the wire before
  // the page goes away.
  if (event.type === "flush") {
    const dirty = [...state.entries].filter((item): item is [string, Dirty] => item[1].status === "dirty")

    if (dirty.length === 0) return unchanged(state)
    const batch = state.batch + 1

    return changed(
      {
        ...state,
        batch,
        entries: replace(
          state.entries,
          dirty.map(([key, entry]): [string, NamespaceEntry] => [
            key,
            { status: "inflight", value: entry.value, batch, deferred: entry.deferred },
          ]),
        ),
      },
      [
        { type: "timer.cancel" },
        {
          type: "send",
          batch,
          insert: Object.fromEntries(
            dirty.flatMap(([key, entry]) => (entry.value === null ? [] : [[key, entry.value]])),
          ),
          remove: dirty.flatMap(([key, entry]) => (entry.value === null ? [key] : [])),
        },
      ],
    )
  }

  // Only keys this batch still owns settle; a key written again since then belongs to a later write.
  if (event.type === "batch.succeeded") {
    const acked = carried(state.entries, event.batch)

    if (acked.length === 0 && state.failures === 0) return unchanged(state)

    return changed({
      ...state,
      failures: 0,
      entries: replace(
        state.entries,
        acked.map(([key, entry]): [string, NamespaceEntry] => [
          key,
          entry.deferred && entry.deferred.revision > event.revision
            ? { status: "synced", ...entry.deferred }
            : { status: "synced", value: entry.value, revision: event.revision },
        ]),
      ),
    })
  }

  // Unsuperseded keys go back to `dirty` and a retry is scheduled with backoff, so a failure never strands them.
  if (event.type === "batch.failed") {
    const failed = carried(state.entries, event.batch)
    const failures = state.failures + 1
    const retry = failed.length > 0 && !queued(state.entries)

    return changed(
      {
        ...state,
        failures,
        entries: replace(
          state.entries,
          failed.map(([key, entry]): [string, NamespaceEntry] => [
            key,
            { status: "dirty", value: entry.value, deferred: entry.deferred },
          ]),
        ),
      },
      retry ? [{ type: "timer.arm", delayMs: retryDelay(failures) }] : [],
    )
  }

  if (event.type === "remote") {
    // The snapshot or clear already reflects everything up to `floor`.
    if (event.revision <= state.floor) return unchanged(state)
    const revision = event.revision

    const updates = [
      ...Object.entries(event.insert),
      ...event.remove.map((key): [string, string | null] => [key, null]),
    ].flatMap(([key, value]): [string, NamespaceEntry][] => {
      const entry = state.entries.get(key)

      if (entry && entry.status !== "synced") {
        const held = hold(entry, { value, revision })

        return held === entry ? [] : [[key, held]]
      }

      if (revision <= (entry?.revision ?? state.floor)) return []

      return [[key, { status: "synced", value, revision }]]
    })

    if (updates.length === 0) return unchanged(state)

    return changed({ ...state, entries: replace(state.entries, updates) })
  }

  // Cleared keys must not come back from events stamped before the clear, so the floor rises to the newest revision
  // this window knows. Batches already sent reach the host before its clear, which deletes them there too.
  return changed(
    {
      ...state,
      status: "loaded",
      entries: new Map(),
      floor: Math.max(
        state.floor,
        ...[...state.entries.values()].map((entry) =>
          entry.status === "synced" ? entry.revision : (entry.deferred?.revision ?? -1),
        ),
      ),
    },
    queued(state.entries) ? [{ type: "timer.cancel" }] : [],
  )
}

export function selectNamespaceItem(state: NamespaceState, key: string) {
  return state.entries.get(key)?.value ?? null
}

export function selectNamespaceKeys(state: NamespaceState) {
  return [...state.entries].flatMap(([key, entry]) => (entry.value === null ? [] : [key]))
}

// The snapshot is the whole truth at its revision: a key it lacks was deleted by then, even if an older event inserted
// it meanwhile. A local key keeps its value and holds the snapshot's, which wins after the ack if the host applied it
// later than the local write.
function snapshot(
  entries: ReadonlyMap<string, NamespaceEntry>,
  items: Readonly<Record<string, string>>,
  revision: number,
) {
  const next = new Map(
    [...entries].flatMap(([key, entry]): [string, NamespaceEntry][] => {
      if (entry.status !== "synced") {
        return [[key, hold(entry, { value: Object.hasOwn(items, key) ? (items[key] ?? null) : null, revision })]]
      }

      return entry.revision > revision ? [[key, entry]] : []
    }),
  )

  Object.entries(items).forEach(([key, value]) => {
    if (!next.has(key)) next.set(key, { status: "synced", value, revision })
  })

  return next
}

function hold(entry: Dirty | Inflight, remote: NamespaceRemote): Dirty | Inflight {
  if (entry.deferred && entry.deferred.revision >= remote.revision) return entry

  return { ...entry, deferred: remote }
}

function carried(entries: ReadonlyMap<string, NamespaceEntry>, batch: number) {
  return [...entries].filter((item): item is [string, Inflight] => {
    const entry = item[1]

    return entry.status === "inflight" && entry.batch === batch
  })
}

function queued(entries: ReadonlyMap<string, NamespaceEntry>) {
  return [...entries.values()].some((entry) => entry.status === "dirty")
}

function replace(entries: ReadonlyMap<string, NamespaceEntry>, updates: readonly [string, NamespaceEntry][]) {
  if (updates.length === 0) return entries
  const next = new Map(entries)
  updates.forEach(([key, entry]) => next.set(key, entry))

  return next
}

function retryDelay(failures: number) {
  return NAMESPACE_FLUSH_DELAY_MS * 2 ** Math.min(failures, NAMESPACE_RETRY_MAX_EXPONENT)
}

function changed(state: NamespaceState, effects: readonly NamespaceEffect[] = []): NamespaceTransition {
  return { state, effects }
}

function unchanged(state: NamespaceState): NamespaceTransition {
  return { state, effects: [] }
}
