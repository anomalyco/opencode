export * as SpaceStore from "./space-store"

import { SpaceRows } from "@opencode/core/space"
import { Database } from "@opencode/core/database/database"
import { KeyedMutex } from "@opencode/core/effect/keyed-mutex"
import { Space } from "@opencode/schema/space"
import { Event } from "@opencode/schema/event"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Clock, Context, Effect, Layer, Scope } from "effect"
import { EventFeed } from "./event-feed"

/** Rows one sync, or one subscribe's catch-up, reads at most across all its spaces. */
export const BatchSize = 500

/** Tombstone-creating deletes in a space between two checks of its tombstones against `SpaceRows.TombstoneLimit`. */
export const PurgeInterval = 64

export type Change = typeof Space.Event.Updated.Type | typeof Space.Event.Deleted.Type
export type Listener = (change: Change) => Effect.Effect<void>
type Send = (event: typeof Space.Event.Resync.Type | Change) => Effect.Effect<void>

export interface Interface {
  /**
   * Commits the changes in one transaction, as `SpaceRows.write` applies them, then sends each one that changed a row
   * in revision order. Returns each space's head after them, with its cursor, in the order the spaces first appear.
   */
  readonly write: (
    changes: ReadonlyArray<Space.Change>,
  ) => Effect.Effect<
    ReadonlyArray<{ readonly space: Space.Name; readonly revision: Space.Revision; readonly cursor: string }>
  >
  /** This database's epoch, created once and kept, so revisions from another server or database are never used. */
  readonly epoch: string
  /** Replaces the epoch: every client's next sync starts from a snapshot, e.g. after a database restore. */
  readonly resetEpoch: Effect.Effect<void>
  /**
   * One page per space after its cursor, in order, of `BatchSize` rows in total: a delta when this database issued the
   * cursor and still holds every deletion after it, else a snapshot; `next` continues it. Once the rows are used up,
   * the remaining spaces are not read and get no page.
   */
  readonly sync: (
    spaces: ReadonlyArray<{ readonly space: Space.Name; readonly cursor?: string }>,
  ) => Effect.Effect<ReadonlyArray<Space.Page>>
  /** Lets `subscribe` address an event stream by its ID while `send` reaches it, until the scope closes. */
  readonly attach: (stream: string, send: Send) => Effect.Effect<void, never, Scope.Scope>
  /**
   * Sends each space's changes since its cursor to the stream as single updated and deleted events, then its live
   * changes, none missed or repeated. The spaces' catch-ups read `BatchSize` rows in total, in order: a space whose
   * changes do not fit what is left, every space after the rows are used up, and one with an unusable cursor get
   * `resync` instead. Replaces earlier subscriptions of those spaces on the stream; false when no such stream is
   * attached.
   */
  readonly subscribe: (
    stream: string,
    spaces: ReadonlyArray<{ readonly space: Space.Name; readonly cursor: string }>,
  ) => Effect.Effect<boolean>
  /** Stops sending those spaces to the stream, also mid catch-up; false when no such stream is attached. */
  readonly unsubscribe: (stream: string, spaces: ReadonlyArray<Space.Name>) => Effect.Effect<boolean>
  /**
   * Runs `listener` with every change before its write returns and before subscribed streams get it, in revision
   * order within a space. Changes never go through the bus, so plugins do not see them.
   */
  readonly listen: (listener: Listener) => Effect.Effect<Effect.Effect<void>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/server/SpaceStore") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    // Without a stored epoch, this process's own one still keeps cursors safe: they only fall back to snapshots.
    let epoch = yield* SpaceRows.epoch(db).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not read the space epoch", { cause }).pipe(Effect.as(crypto.randomUUID())),
      ),
    )
    const listeners = new Array<Listener>()
    // Held per space from the commit until listeners have its changes, so they get each space in revision order.
    // Reads and other spaces never wait on it.
    const locks = KeyedMutex.makeUnsafe<Space.Name>()
    // Tombstone-creating deletes per space since its last purge check. A space missing here, as after a restart, is
    // checked on its next one, so between commits a space holds at most `PurgeInterval - 1` tombstones past the limit.
    const deletes = new Map<Space.Name, number>()
    const tombstoned = (space: Space.Name, count: number) =>
      Effect.suspend(() => {
        if (count === 0) return Effect.void
        const since = (deletes.get(space) ?? PurgeInterval - 1) + count
        if (since < PurgeInterval) return Effect.sync(() => deletes.set(space, since))
        // The deletes are committed already, so a failed purge must not keep listeners from hearing of them.
        return SpaceRows.purge(db, space).pipe(
          Effect.andThen(Effect.sync(() => deletes.set(space, 0))),
          Effect.catchCause((cause) => Effect.logWarning("Could not purge space tombstones", { space, cause })),
        )
      })

    // Each attached stream with its subscribed spaces. A subscription holds the changes that arrive while its catch-up
    // is read, then forwards only those after the revision the catch-up covers.
    const streams = new Map<string, Attached>()
    const deliver = (stream: Attached, change: Change) =>
      Effect.suspend(() => {
        const subscription = stream.spaces.get(change.data.space)
        if (!subscription) return Effect.void
        if (subscription.pending) {
          subscription.pending.push(change)
          return Effect.void
        }
        return change.data.revision > subscription.covered ? stream.send(change) : Effect.void
      })

    // One page of at most `limit` rows. A snapshot reads live rows only, up to the head it started from, and its last
    // page reports that head; a key written meanwhile moves above it, and `next` continues with a delta from there.
    // A delta reads every row after its cursor, so a key rewritten meanwhile moves to a later page.
    const page = (space: Space.Name, cursor: string | undefined, limit: number) =>
      Effect.gen(function* () {
        const position = cursor === undefined ? undefined : parse(epoch, cursor)
        const from: SpaceRows.From =
          position?.head === undefined
            ? position
              ? { type: "delta", since: position.since, snapshot: true }
              : { type: "snapshot", since: 0 }
            : position.since > position.head
              ? { type: "snapshot", since: 0 }
              : { type: "snapshot", since: position.since, until: position.head }
        const read = yield* SpaceRows.read(db, space, from, limit + 1)
        const more = read.rows.length > limit
        const kept = read.rows.slice(0, limit)
        if (read.continued && from.type === "delta") {
          const revision = kept.at(-1)?.revision ?? from.since
          const delta: Space.Page = {
            type: "delta",
            space,
            epoch,
            revision,
            entries: entries(kept),
            deleted: deleted(kept),
            cursor: `${epoch}.${revision}`,
            next: more ? `${epoch}.${revision}` : undefined,
          }
          return delta
        }
        const since = read.continued ? from.since : 0
        const until = read.continued && from.type === "snapshot" ? (from.until ?? read.head) : read.head
        const revision = more ? (kept.at(-1)?.revision ?? since) : until
        const snapshot: Space.Page = {
          type: "snapshot",
          space,
          epoch,
          revision,
          entries: entries(kept),
          cursor: `${epoch}.${revision}`,
          next: more ? `${epoch}.${revision}.${until}` : read.head > until ? `${epoch}.${until}` : undefined,
        }
        return snapshot
      })

    // The changes since the subscription's cursor, one event per row in revision order, with the revision they cover
    // and the rows read; `resync` instead when they do not fit `budget` or the cursor is unusable.
    const catchUp = (space: Space.Name, cursor: string, budget: number) =>
      Effect.gen(function* () {
        const position = parse(epoch, cursor)
        const created = yield* Clock.currentTimeMillis
        const resync = (read: number) => ({
          covered: 0,
          read,
          events: [{ id: Event.ID.create(), created, type: Space.Event.Resync.type, data: { space } }],
        })
        if (budget === 0 || !position || position.head !== undefined) return resync(0)
        const read = yield* SpaceRows.read(
          db,
          space,
          { type: "delta", since: position.since, snapshot: false },
          budget + 1,
        )
        if (!read.continued || read.rows.length > budget) return resync(read.rows.length)
        return {
          covered: read.rows.at(-1)?.revision ?? position.since,
          read: read.rows.length,
          events: read.rows.map((row) => change(space, row, created)),
        }
      })

    return Service.of({
      write: Effect.fn("SpaceStore.write")(function* (changes) {
        // Every write takes its spaces' locks in the same order, so two writes never wait on each other.
        return yield* [...new Set(changes.map((change) => change.space))].toSorted().reduceRight(
          (effect, space) => locks.withLock(space)(effect),
          // A dropped request must not commit changes that listeners never hear about.
          Effect.uninterruptible(
            Effect.gen(function* () {
              const result = yield* SpaceRows.write(db, changes)
              const tombstones = Map.groupBy(
                result.written.filter((row) => row.value === null),
                (row) => row.space,
              )
              yield* Effect.forEach(tombstones, ([space, rows]) => tombstoned(space, rows.length), { discard: true })
              const created = yield* Clock.currentTimeMillis
              for (const row of result.written) {
                const committed = change(row.space, row, created)
                yield* Effect.forEach(listeners, (listener) => listener(committed), { discard: true })
                yield* Effect.forEach(streams.values(), (stream) => deliver(stream, committed), { discard: true })
              }
              return result.heads.map((head) => ({ ...head, cursor: `${epoch}.${head.revision}` }))
            }),
          ),
        )
      }),
      get epoch() {
        return epoch
      },
      resetEpoch: Effect.fn("SpaceStore.resetEpoch")(function* () {
        epoch = yield* SpaceRows.resetEpoch(db)
      })(),
      sync: Effect.fn("SpaceStore.sync")(function* (requests) {
        const pages = new Array<Space.Page>()
        let budget = BatchSize
        for (const request of requests) {
          if (budget === 0) break
          const next = yield* page(request.space, request.cursor, budget)
          budget -= next.entries.length + (next.type === "delta" ? next.deleted.length : 0)
          pages.push(next)
        }
        return pages
      }),
      attach: (id, send) =>
        Effect.acquireRelease(
          Effect.sync(() => streams.set(id, { send, spaces: new Map() })),
          () => Effect.sync(() => streams.delete(id)),
        ).pipe(Effect.asVoid),
      subscribe: Effect.fn("SpaceStore.subscribe")(function* (id, requests) {
        const stream = streams.get(id)
        if (!stream) return false
        const subscriptions = requests.map((request) => {
          const subscription: Subscription = { covered: 0, pending: [] }
          stream.spaces.set(request.space, subscription)
          return { request, subscription }
        })
        let budget = BatchSize
        yield* Effect.forEach(
          subscriptions,
          ({ request, subscription }) =>
            Effect.gen(function* () {
              // A later subscribe of this space on the stream replaces this one and sends its own catch-up, so this
              // one stops sending as soon as it is replaced.
              const current = () => stream.spaces.get(request.space) === subscription
              const first = yield* catchUp(request.space, request.cursor, budget)
              budget = Math.max(0, budget - first.read)
              if (!subscription.pending) return
              subscription.covered = first.covered
              for (const event of first.events) if (current()) yield* stream.send(event)
              // Changes arriving while these go out join the end, so the space stays in revision order.
              for (
                let change = subscription.pending.shift();
                change && current();
                change = subscription.pending.shift()
              )
                if (change.data.revision > subscription.covered) yield* stream.send(change)
              subscription.pending = undefined
            }),
          { discard: true },
        ).pipe(
          // A subscribe that fails or is dropped before its catch-up goes out leaves nothing holding changes.
          Effect.ensuring(
            Effect.sync(() => {
              for (const { request, subscription } of subscriptions)
                if (subscription.pending && stream.spaces.get(request.space) === subscription)
                  stream.spaces.delete(request.space)
            }),
          ),
        )
        return true
      }),
      unsubscribe: (id, spaces) =>
        Effect.sync(() => {
          const stream = streams.get(id)
          for (const space of spaces) stream?.spaces.delete(space)
          return stream !== undefined
        }),
      listen: (listener) =>
        Effect.sync(() => {
          listeners.push(listener)
          return Effect.sync(() => {
            const index = listeners.indexOf(listener)
            if (index >= 0) listeners.splice(index, 1)
          })
        }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })

/** Attaches every event stream to the store, so `subscribe` can send space changes to it. */
export const extension = Effect.gen(function* () {
  const store = yield* Service
  return { open: (stream, send) => store.attach(stream, send) } satisfies EventFeed.Extension
})

interface Subscription {
  covered: Space.Revision
  pending: Array<Change> | undefined
}

interface Attached {
  readonly send: Send
  readonly spaces: Map<Space.Name, Subscription>
}

function change(
  space: Space.Name,
  row: { readonly key: Space.Key; readonly value: Space.Value | null; readonly revision: Space.Revision },
  created: number,
): Change {
  return row.value === null
    ? {
        id: Event.ID.create(),
        created,
        type: Space.Event.Deleted.type,
        data: { space, key: row.key, revision: row.revision },
      }
    : {
        id: Event.ID.create(),
        created,
        type: Space.Event.Updated.type,
        data: { space, key: row.key, value: row.value, revision: row.revision },
      }
}

function entries(rows: ReadonlyArray<{ readonly key: Space.Key; readonly value: Space.Value | null }>) {
  return rows.flatMap((row) => (row.value === null ? [] : [{ key: row.key, value: row.value }]))
}

function deleted(rows: ReadonlyArray<{ readonly key: Space.Key; readonly value: Space.Value | null }>) {
  return rows.flatMap((row) => (row.value === null ? [row.key] : []))
}

// `epoch.revision`, or `epoch.revision.head` while a snapshot goes out. A cursor from another epoch, or one that does
// not parse, is unusable.
function parse(epoch: string, cursor: string) {
  if (!cursor.startsWith(`${epoch}.`)) return undefined
  const parts = cursor.slice(epoch.length + 1).split(".")
  if (parts.length > 2 || !parts.every((part) => /^\d+$/u.test(part) && Number.isSafeInteger(Number(part))))
    return undefined
  return { since: Number(parts[0]), head: parts[1] === undefined ? undefined : Number(parts[1]) }
}
