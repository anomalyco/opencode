export * as EventV2 from "./event"

import { Cause, Context, Deferred, Effect, Layer, Option, PubSub, Queue, Schedule, Schema, Stream } from "effect"
import { Event } from "@opencode-ai/schema/event"
import type { Data, Definition, Payload } from "@opencode-ai/schema/event"
import { and, asc, eq, gt, inArray } from "drizzle-orm"
import { Database } from "./database/database"
import { EventSequenceTable, EventTable } from "./event/sql"
import { Location } from "./location"
import { makeGlobalNode } from "./effect/app-node"
import { isDeepStrictEqual } from "node:util"
import { createHash } from "node:crypto"
import { isSqlError, type SqlError } from "effect/unstable/sql/SqlError"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"
import { Durable } from "@opencode-ai/schema/durable-event-manifest"

export const ID = Event.ID
export type ID = import("@opencode-ai/schema/event").ID
export type { Data, Definition, Payload } from "@opencode-ai/schema/event"

export type Subscriber<D extends Definition = Definition> = (event: Payload<D>) => Effect.Effect<void>
export type Unsubscribe = Effect.Effect<void>

const EMPTY_SUBSCRIBERS: ReadonlyArray<Subscriber> = []
/** Sliding live fan-out: a stalled subscriber drops its oldest events instead of retaining them unbounded. */
const EVENT_PUBSUB_CAPACITY = 8192
/** Bounds each durable backfill query; the stream pages until it has drained the aggregate tail. */
const DURABLE_READ_LIMIT = 512
/** Bounded retries for a lock-contention (`SQLITE_BUSY`/`SQLITE_LOCKED`) write transaction. */
const DURABLE_BUSY_RETRIES = 3

// Drizzle-decoded rows and `Schema.encodeUnknownSync` can serialize the same value with
// different object key order, which would make a `JSON.stringify`-based digest diverge
// spuriously. Sort keys recursively so the digest depends on the value, not the encoder.
const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== "object") return value
  return Object.keys(value as Record<string, unknown>)
    .toSorted()
    .reduce<Record<string, unknown>>((out, key) => {
      const entry = (value as Record<string, unknown>)[key]
      if (entry !== undefined) out[key] = canonicalize(entry)
      return out
    }, {})
}

/** Stable content digest used to keep tombstoned diff rows replay-idempotent without weakening divergence checks. */
export const eventDigest = (data: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalize(data)) ?? "")
    .digest("hex")

/**
 * Digest of the raw serialization order, accepted only when reading a stored tombstone.
 * Rows written before `eventDigest` canonicalized keys must still replay idempotently.
 */
const legacyEventDigest = (data: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(data) ?? "")
    .digest("hex")

const isRetryableSqlError = (error: unknown): error is SqlError => isSqlError(error) && error.isRetryable
const retryDurableBusy = Schedule.exponential("25 millis", 2).pipe(
  Schedule.either(Schedule.spaced("250 millis")),
  Schedule.jittered,
)

export type SerializedEvent = {
  readonly id: ID
  readonly type: string
  readonly seq: number
  readonly aggregateID: string
  readonly data: Record<string, unknown>
}

export class InvalidDurableEventError extends Schema.TaggedErrorClass<InvalidDurableEventError>()(
  "EventV2.InvalidDurableEvent",
  {
    type: Schema.String,
    message: Schema.String,
  },
) {}

/** Lock contention outlasted every bounded retry; the durable write never committed. */
export class DatabaseBusyError extends Schema.TaggedErrorClass<DatabaseBusyError>()("EventV2.DatabaseBusy", {
  operation: Schema.String,
  attempts: Schema.Int,
  message: Schema.String,
}) {}

// Drizzle wraps a query failure in EffectDrizzleQueryError whose `cause` carries the typed
// SqlError, so a lock-contention error has to be unwrapped before retryability can be judged.
const retryableSqlError = (error: unknown): SqlError | undefined => {
  if (isRetryableSqlError(error)) return error
  if (!(error instanceof EffectDrizzleQueryError)) return undefined
  const inner = Cause.findErrorOption(error.cause as Cause.Cause<unknown>)
  return Option.isSome(inner) && isRetryableSqlError(inner.value) ? inner.value : undefined
}

/**
 * Bounded retry for a single lock-contending statement. `orDie` on an inner statement would turn a
 * transient `SQLITE_BUSY` into a defect the outer transaction retry cannot observe, so every write
 * statement that can contend for the lock is wrapped here before it is defected.
 */
const retryDurableWrite =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.retry({
        while: (error: E) => retryableSqlError(error) !== undefined,
        schedule: retryDurableBusy,
        times: DURABLE_BUSY_RETRIES,
      }),
      Effect.catchIf(
        (error: E) => retryableSqlError(error) !== undefined,
        (error: E) =>
          Effect.die(
            new DatabaseBusyError({
              operation,
              attempts: DURABLE_BUSY_RETRIES + 1,
              message: retryableSqlError(error)?.message ?? String(error),
            }),
          ),
      ),
    )

export const latestSequence = Effect.fn("EventV2.latestSequence")(function* (
  db: Database.Interface["db"],
  aggregateID: string,
) {
  const row = yield* db
    .select({ seq: EventSequenceTable.seq })
    .from(EventSequenceTable)
    .where(eq(EventSequenceTable.aggregate_id, aggregateID))
    .get()
    .pipe(retryDurableWrite("event.latestSequence"), Effect.orDie)
  return row?.seq ?? -1
})

// The durable read path must never die on a row it cannot decode (newer/older
// build, removed type); `replay()` keeps the strict die for authoritative streams.
const decodeSerializedEvent = (event: SerializedEvent): Option.Option<Payload> => {
  const definition = Durable.get(event.type)
  const durable = definition?.durable
  if (!definition || !durable) return Option.none()
  return Schema.decodeUnknownOption(definition.data)(event.data).pipe(
    Option.map(
      (data): Payload => ({
        id: event.id,
        type: definition.type,
        durable: { aggregateID: event.aggregateID, seq: event.seq, version: durable.version },
        data,
      }),
    ),
  )
}

export const readAggregate = Effect.fn("EventV2.readAggregate")(function* <A>(
  db: Database.Interface["db"],
  input: {
    readonly aggregateID: string
    readonly after?: number
    readonly limit: number
    readonly manifest: {
      readonly definitions: ReadonlyMap<string, Definition>
      readonly schema: Schema.Decoder<A, never>
    }
    /**
     * Authoritative replay opts in: an undecodable row becomes a defect instead of a
     * silent skip. The default stays lenient for forward/backward build compatibility.
     */
    readonly strict?: boolean
  },
) {
  const after = input.after ?? -1
  const rows = yield* db
    .select()
    .from(EventTable)
    .where(
      and(
        eq(EventTable.aggregate_id, input.aggregateID),
        gt(EventTable.seq, after),
        inArray(EventTable.type, Array.from(input.manifest.definitions.keys())),
      ),
    )
    .orderBy(asc(EventTable.seq))
    .limit(input.limit + 1)
    .all()
    .pipe(Effect.orDie)
  const page = rows.slice(0, input.limit)
  const payload = (event: (typeof rows)[number]) => ({
    id: event.id,
    type: input.manifest.definitions.get(event.type)?.type ?? event.type,
    durable: {
      aggregateID: event.aggregate_id,
      seq: event.seq,
      version: input.manifest.definitions.get(event.type)?.durable?.version,
    },
    data: event.data,
  })
  const decode = Schema.decodeUnknownOption(input.manifest.schema)
  const events = input.strict
    ? page.map((event) => Schema.decodeUnknownSync(input.manifest.schema)(payload(event)))
    : page.flatMap((event) => {
        const decoded = decode(payload(event))
        return Option.isSome(decoded) ? [decoded.value] : []
      })
  const skipped = page.length - events.length
  if (skipped > 0)
    yield* Effect.logWarning("EventV2.readAggregate skipped undecodable events", {
      aggregateID: input.aggregateID,
      skipped,
    })
  return {
    events,
    hasMore: rows.length > input.limit,
  }
})

export class SubscriberOverflowError extends Schema.TaggedErrorClass<SubscriberOverflowError>()(
  "EventV2.SubscriberOverflow",
  { capacity: Schema.Int },
) {}

export const define = Event.define
export const versionedType = Event.versionedType

export interface PublishOptions {
  readonly id?: ID
  readonly metadata?: Record<string, unknown>
  readonly location?: Location.Ref
  /**
   * Local operational projection committed atomically with a new durable event. Not replayed or serialized.
   *
   * Runs inside the same `BEGIN IMMEDIATE` transaction as the event log write, so it must be a
   * synchronous database-only effect: no network, filesystem, or other external I/O, and no
   * nested transactions. Anything that can block here holds the process-wide writer lock.
   */
  readonly commit?: (seq: number) => Effect.Effect<void>
}

export interface Interface {
  readonly publish: <D extends Definition>(
    definition: D,
    data: Data<D>,
    options?: PublishOptions,
  ) => Effect.Effect<Payload<D>>
  readonly subscribe: <D extends Definition>(definition: D) => Stream.Stream<Payload<D>>
  readonly all: () => Stream.Stream<Payload>
  readonly durable: (input: { readonly aggregateID: string; readonly after?: number }) => Stream.Stream<Payload>
  /** @deprecated Use `all()` and consume the returned stream. */
  readonly listen: (listener: Subscriber) => Effect.Effect<Unsubscribe>
  readonly project: <D extends Definition>(definition: D, projector: Subscriber<D>) => Effect.Effect<void>
  readonly replay: (
    event: SerializedEvent,
    options?: { readonly publish?: boolean; readonly ownerID?: string; readonly strictOwner?: boolean },
  ) => Effect.Effect<void>
  readonly replayAll: (
    events: SerializedEvent[],
    options?: { readonly publish?: boolean; readonly ownerID?: string; readonly strictOwner?: boolean },
  ) => Effect.Effect<string | undefined>
  readonly remove: (aggregateID: string) => Effect.Effect<void>
  readonly claim: (aggregateID: string, ownerID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Event") {}

export const allBounded = (events: Interface, capacity: number) =>
  Effect.gen(function* () {
    const queue = yield* Queue.dropping<Payload, SubscriberOverflowError>(capacity)
    const unsubscribe = yield* events.listen((event) =>
      Queue.offer(queue, event).pipe(
        Effect.flatMap((accepted) =>
          accepted ? Effect.void : Queue.fail(queue, new SubscriberOverflowError({ capacity })).pipe(Effect.asVoid),
        ),
      ),
    )
    yield* Effect.addFinalizer(() => unsubscribe.pipe(Effect.andThen(Queue.shutdown(queue)), Effect.asVoid))
    return Stream.fromQueue(queue)
  })

export interface LayerOptions {
  readonly beforeAggregateRead?: (aggregateID: string) => Effect.Effect<void>
}

// Aggregates removed by `remove()` are tombstoned so a durable stream created afterwards
// ends immediately instead of parking on a wake that will never receive a null (v8 NEW-07).
// The tombstone is bounded: a workload that removes many aggregates without ever re-creating
// them would otherwise grow it for the process lifetime (v9 NEW-V9-05). Oldest removals are
// evicted first, so the newest removes stay terminal. Residual: a `durable()` created after
// more than MAX_REMOVED_AGGREGATES later removes on that same aggregate can park again, which
// is preferable to unbounded growth; re-creating the aggregate clears the tombstone either way.
export const MAX_REMOVED_AGGREGATES = 4_096

export function rememberRemoved(removed: Set<string>, aggregateID: string, max = MAX_REMOVED_AGGREGATES) {
  // Re-insert so eviction order tracks the latest removal, then drop the oldest tombstones.
  removed.delete(aggregateID)
  removed.add(aggregateID)
  while (removed.size > max) {
    const oldest = removed.values().next()
    if (oldest.done) break
    removed.delete(oldest.value)
  }
}

// A durable wake coalesces payloads through a sliding(1) pubsub, so a terminal removal
// can be evicted by a later signal. The Deferred carries termination independently.
type DurableWake = {
  readonly wake: PubSub.PubSub<Payload | null>
  readonly removed: Deferred.Deferred<void>
}

export const layerWith = (options?: LayerOptions) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const pubsub = {
        all: yield* PubSub.sliding<Payload>(EVENT_PUBSUB_CAPACITY),
        durable: new Map<string, Set<DurableWake>>(),
        typed: new Map<string, PubSub.PubSub<Payload>>(),
      }
      const projectors = new Map<string, Subscriber[]>()
      // Tombstones for `remove()`d aggregates; bounded by `rememberRemoved`. Cleared when
      // the aggregate is re-created by a later commit.
      const removedAggregates = new Set<string>()
      // TODO: Bind durable projectors to exact type+version before supporting incompatible historical payloads.
      const listeners = new Array<Subscriber>()
      const { db } = yield* Database.Service

      const getOrCreate = (definition: Definition) =>
        Effect.gen(function* () {
          const existing = pubsub.typed.get(definition.type)
          if (existing) return existing
          const created = yield* PubSub.sliding<Payload>(EVENT_PUBSUB_CAPACITY)
          pubsub.typed.set(definition.type, created)
          return created
        })

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* PubSub.shutdown(pubsub.all)
          yield* Effect.forEach(
            pubsub.durable.values(),
            (wakes) => Effect.forEach(wakes, (wake) => PubSub.shutdown(wake.wake), { discard: true }),
            { discard: true },
          )
          yield* Effect.forEach(pubsub.typed.values(), PubSub.shutdown, { discard: true })
        }),
      )

      function commitDurableEvent(
        definition: Definition,
        event: Payload,
        input?: {
          readonly seq: number
          readonly aggregateID: string
          readonly ownerID?: string
          readonly strictOwner?: boolean
        },
        commit?: (seq: number) => Effect.Effect<void>,
      ) {
        return Effect.gen(function* () {
          const durable = definition?.durable
          if (durable) {
            const aggregateID = (event.data as Record<string, unknown>)[durable.aggregate]
            if (typeof aggregateID !== "string") {
              yield* Effect.die(
                new InvalidDurableEventError({
                  type: event.type,
                  message: `Expected string aggregate field ${durable.aggregate}`,
                }),
              )
            } else {
              if (input && input.aggregateID !== aggregateID) {
                yield* Effect.die(
                  new InvalidDurableEventError({
                    type: event.type,
                    message: `Aggregate mismatch: expected ${input.aggregateID}, got ${aggregateID}`,
                  }),
                )
              }
              const list = projectors.get(event.type) ?? EMPTY_SUBSCRIBERS
              return yield* Effect.uninterruptible(
                Effect.gen(function* () {
                  const committed = yield* db
                    .transaction(
                      () =>
                        Effect.gen(function* () {
                          const row = yield* db
                            .select({ seq: EventSequenceTable.seq, ownerID: EventSequenceTable.owner_id })
                            .from(EventSequenceTable)
                            .where(eq(EventSequenceTable.aggregate_id, aggregateID))
                            .get()
                            .pipe(retryDurableWrite("durableEvent.readSequence"), Effect.orDie)
                          const latest = row?.seq ?? -1
                          const encoded = Schema.encodeUnknownSync(definition.data)(event.data) as Record<
                            string,
                            unknown
                          >
                          if (input?.strictOwner && row?.ownerID && row.ownerID !== input.ownerID) {
                            yield* Effect.die(
                              new InvalidDurableEventError({
                                type: event.type,
                                message: `Replay owner mismatch for aggregate ${aggregateID}: expected ${row.ownerID}, got ${input.ownerID ?? "none"}`,
                              }),
                            )
                          }
                          if (input && input.seq <= latest) {
                            const stored = yield* db
                              .select()
                              .from(EventTable)
                              .where(and(eq(EventTable.aggregate_id, aggregateID), eq(EventTable.seq, input.seq)))
                              .get()
                              .pipe(retryDurableWrite("durableEvent.readReplay"), Effect.orDie)
                            if (
                              stored?.id === event.id &&
                              stored.type === versionedType(definition.type, durable.version) &&
                              (isDeepStrictEqual(stored.data, encoded) ||
                                (stored.tombstone_digest != null &&
                                  (stored.tombstone_digest === eventDigest(encoded) ||
                                    stored.tombstone_digest === legacyEventDigest(encoded))))
                            ) {
                              if (input.ownerID && row?.ownerID == null) {
                                yield* db
                                  .update(EventSequenceTable)
                                  .set({ owner_id: input.ownerID })
                                  .where(eq(EventSequenceTable.aggregate_id, aggregateID))
                                  .run()
                                  .pipe(retryDurableWrite("durableEvent.claimOwner"), Effect.orDie)
                              }
                              return
                            }
                            yield* Effect.die(
                              new InvalidDurableEventError({
                                type: event.type,
                                message: `Replay diverged at aggregate ${aggregateID} sequence ${input.seq}`,
                              }),
                            )
                          }
                          if (input && row?.ownerID && row.ownerID !== input.ownerID) {
                            return
                          }
                          const seq = input?.seq ?? latest + 1
                          if (input && seq !== latest + 1) {
                            yield* Effect.die(
                              new InvalidDurableEventError({
                                type: event.type,
                                message: `Sequence mismatch for aggregate ${aggregateID}: expected ${latest + 1}, got ${seq}`,
                              }),
                            )
                          }
                          const stored = yield* db
                            .select({ aggregateID: EventTable.aggregate_id, seq: EventTable.seq })
                            .from(EventTable)
                            .where(eq(EventTable.id, event.id))
                            .get()
                            .pipe(retryDurableWrite("durableEvent.readExisting"), Effect.orDie)
                          if (stored)
                            yield* Effect.die(
                              new InvalidDurableEventError({
                                type: event.type,
                                message: `Event ${event.id} already exists at aggregate ${stored.aggregateID} sequence ${stored.seq}`,
                              }),
                            )
                          const committed = {
                            ...event,
                            durable: { aggregateID, seq, version: durable.version },
                          } as Payload
                          for (const projector of list) {
                            yield* projector(committed)
                          }
                          if (commit) yield* commit(seq)
                          yield* db
                            .insert(EventSequenceTable)
                            .values([{ aggregate_id: aggregateID, seq, owner_id: input?.ownerID }])
                            .onConflictDoUpdate({
                              target: EventSequenceTable.aggregate_id,
                              set: {
                                seq,
                                ...(input?.ownerID && row?.ownerID == null ? { owner_id: input.ownerID } : {}),
                              },
                            })
                            .run()
                            .pipe(retryDurableWrite("durableEvent.upsertSequence"), Effect.orDie)
                          yield* db
                            .insert(EventTable)
                            .values([
                              {
                                id: event.id,
                                aggregate_id: aggregateID,
                                seq,
                                type: versionedType(definition.type, durable.version),
                                data: encoded,
                              },
                            ])
                            .run()
                            .pipe(retryDurableWrite("durableEvent.insertEvent"), Effect.orDie)
                          return { aggregateID, seq }
                        }),
                      { behavior: "immediate" },
                    )
                    .pipe(retryDurableWrite("durableEvent.commit"), Effect.orDie)
                  if (committed) {
                    removedAggregates.delete(committed.aggregateID)
                    const wakes = pubsub.durable.get(committed.aggregateID)
                    if (wakes) {
                      const wakePayload = {
                        ...event,
                        durable: { aggregateID: committed.aggregateID, seq: committed.seq, version: durable.version },
                      } as Payload
                      yield* Effect.forEach(wakes, (wake) => PubSub.publish(wake.wake, wakePayload), {
                        discard: true,
                      })
                    }
                  }
                  return committed
                }),
              )
            }
          }
        })
      }

      function publishEvent<D extends Definition>(definition: D, event: Payload<D>, commit?: PublishOptions["commit"]) {
        return Effect.gen(function* () {
          if (!definition?.durable && commit)
            return yield* Effect.die(
              new InvalidDurableEventError({
                type: event.type,
                message: "Local commit hooks require a durable event",
              }),
            )
          if (definition?.durable) {
            const committed = yield* commitDurableEvent(definition, event as Payload, undefined, commit)
            if (committed) {
              event = {
                ...event,
                durable: {
                  aggregateID: committed.aggregateID,
                  seq: committed.seq,
                  version: definition.durable.version,
                },
              }
              yield* notify(event as Payload, true)
              return event
            }
          }
          yield* notify(event as Payload, false)
          return event
        })
      }

      const observe = (event: Payload, observer: (event: Payload) => Effect.Effect<void>) =>
        Effect.suspend(() => observer(event)).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterrupts(cause),
            (cause) => Effect.logError("Event listener failed", { eventID: event.id, eventType: event.type, cause }),
          ),
        )

      function notify(event: Payload, isolateListeners: boolean) {
        return Effect.gen(function* () {
          // Snapshot so an unsubscribe mid-dispatch cannot shift and skip a listener.
          const snapshot = listeners.slice()
          const publishPubSub = Effect.gen(function* () {
            const typed = pubsub.typed.get(event.type)
            if (typed) yield* PubSub.publish(typed, event)
            yield* PubSub.publish(pubsub.all, event)
          })
          if (isolateListeners) {
            yield* Effect.forEach(snapshot, (listener) => observe(event, listener), { discard: true })
            yield* publishPubSub
            return
          }
          // Live-only publishes stay fail-fast, but each listener is isolated so one defect
          // cannot skip the remaining listeners or the pubsub fan-out. Interrupts still
          // short-circuit; the first non-interrupt defect is re-raised after fan-out.
          const failures: Cause.Cause<never>[] = []
          yield* Effect.forEach(
            snapshot,
            (listener) =>
              Effect.suspend(() => listener(event)).pipe(
                Effect.catchCauseIf(
                  (cause) => !Cause.hasInterrupts(cause),
                  (cause) => Effect.sync(() => failures.push(cause)),
                ),
              ),
            { discard: true },
          )
          yield* publishPubSub
          const firstFailure = failures[0]
          if (firstFailure) return yield* Effect.failCause(firstFailure)
        })
      }

      function publish<D extends Definition>(definition: D, data: Data<D>, options?: PublishOptions) {
        return Effect.gen(function* () {
          const serviceLocation = Option.getOrUndefined(yield* Effect.serviceOption(Location.Service))
          const location =
            options?.location ??
            (serviceLocation
              ? { directory: serviceLocation.directory, workspaceID: serviceLocation.workspaceID }
              : undefined)
          return yield* publishEvent(
            definition,
            {
              id: options?.id ?? ID.create(),
              ...(options?.metadata ? { metadata: options.metadata } : {}),
              type: definition.type,
              ...(location ? { location } : {}),
              data,
            } as Payload<D>,
            options?.commit,
          )
        })
      }

      function replay(
        event: SerializedEvent,
        options?: { readonly publish?: boolean; readonly ownerID?: string; readonly strictOwner?: boolean },
      ) {
        return Effect.gen(function* () {
          const definition = Durable.get(event.type)
          if (!definition?.durable) {
            yield* Effect.die(
              new InvalidDurableEventError({ type: event.type, message: `Unknown durable event type ${event.type}` }),
            )
          } else {
            const payload = {
              id: event.id,
              type: definition.type,
              data: Schema.decodeUnknownSync(definition.data)(event.data),
            } as Payload
            const committed = yield* commitDurableEvent(definition, payload, {
              seq: event.seq,
              aggregateID: event.aggregateID,
              ownerID: options?.ownerID,
              strictOwner: options?.strictOwner,
            })
            if (committed && options?.publish) {
              yield* notify(
                {
                  ...payload,
                  durable: {
                    aggregateID: committed.aggregateID,
                    seq: committed.seq,
                    version: definition.durable.version,
                  },
                },
                true,
              )
            }
          }
        })
      }

      function replayAll(
        events: SerializedEvent[],
        options?: { readonly publish?: boolean; readonly ownerID?: string; readonly strictOwner?: boolean },
      ) {
        return Effect.gen(function* () {
          const source = events[0]?.aggregateID
          if (!source) return undefined
          if (events.some((event) => event.aggregateID !== source)) {
            yield* Effect.die(
              new InvalidDurableEventError({
                type: events[0]?.type ?? "unknown",
                message: "Replay events must belong to the same aggregate",
              }),
            )
          }
          const start = events[0]?.seq ?? 0
          for (const [index, event] of events.entries()) {
            const seq = start + index
            if (event.seq !== seq) {
              yield* Effect.die(
                new InvalidDurableEventError({
                  type: event.type,
                  message: `Replay sequence mismatch at index ${index}: expected ${seq}, got ${event.seq}`,
                }),
              )
            }
          }
          for (const event of events) {
            yield* replay(event, options)
          }
          return source
        })
      }

      function remove(aggregateID: string) {
        return Effect.gen(function* () {
          yield* db
            .transaction(
              () =>
                Effect.gen(function* () {
                  yield* db
                    .delete(EventSequenceTable)
                    .where(eq(EventSequenceTable.aggregate_id, aggregateID))
                    .run()
                    .pipe(retryDurableWrite("event.remove"), Effect.orDie)
                  yield* db
                    .delete(EventTable)
                    .where(eq(EventTable.aggregate_id, aggregateID))
                    .run()
                    .pipe(retryDurableWrite("event.remove"), Effect.orDie)
                }),
              { behavior: "immediate" },
            )
            .pipe(retryDurableWrite("event.remove"), Effect.orDie)
          // Terminal null marker ends durable streams against a deleted log; the Deferred
          // guarantees termination even when the sliding(1) wake evicts the null.
          rememberRemoved(removedAggregates, aggregateID)
          const wakes = pubsub.durable.get(aggregateID)
          if (wakes)
            yield* Effect.forEach(
              wakes,
              (wake) => PubSub.publish(wake.wake, null).pipe(Effect.andThen(Deferred.succeed(wake.removed, undefined))),
              { discard: true },
            )
        })
      }

      function claim(aggregateID: string, ownerID: string) {
        return db
          .update(EventSequenceTable)
          .set({ owner_id: ownerID })
          .where(eq(EventSequenceTable.aggregate_id, aggregateID))
          .run()
          .pipe(retryDurableWrite("event.claim"), Effect.orDie)
      }

      const subscribe = <D extends Definition>(definition: D): Stream.Stream<Payload<D>> =>
        Stream.unwrap(getOrCreate(definition).pipe(Effect.map((pubsub) => Stream.fromPubSub(pubsub)))).pipe(
          Stream.map((event) => event as Payload<D>),
        )

      const streamAll = (): Stream.Stream<Payload> => Stream.fromPubSub(pubsub.all)

      const readPage = (aggregateID: string, after: number) =>
        (options?.beforeAggregateRead?.(aggregateID) ?? Effect.void).pipe(
          Effect.andThen(
            db
              .select()
              .from(EventTable)
              .where(and(eq(EventTable.aggregate_id, aggregateID), gt(EventTable.seq, after)))
              .orderBy(asc(EventTable.seq))
              .limit(DURABLE_READ_LIMIT)
              .all(),
          ),
          Effect.orDie,
          Effect.map((rows) => ({
            lastSeq: rows.at(-1)?.seq,
            full: rows.length === DURABLE_READ_LIMIT,
            decoded: rows.map((event) =>
              decodeSerializedEvent({
                id: event.id,
                aggregateID: event.aggregate_id,
                seq: event.seq,
                type: event.type,
                data: event.data,
              }),
            ),
          })),
          Effect.tap((page) =>
            page.decoded.some(Option.isNone)
              ? Effect.logWarning("EventV2.durable skipped undecodable events", {
                  aggregateID,
                  skipped: page.decoded.filter(Option.isNone).length,
                })
              : Effect.void,
          ),
          Effect.map((page) => ({
            lastSeq: page.lastSeq,
            full: page.full,
            events: page.decoded.flatMap((event) => (Option.isSome(event) ? [event.value] : [])),
          })),
        )

      const subscribeDurable = (aggregateID: string) =>
        Effect.gen(function* () {
          const wake = yield* PubSub.sliding<Payload | null>(1)
          const removed = yield* Deferred.make<void>()
          const handle: DurableWake = { wake, removed }
          const subscription = yield* PubSub.subscribe(wake)
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const wakes = pubsub.durable.get(aggregateID) ?? new Set()
              wakes.add(handle)
              pubsub.durable.set(aggregateID, wakes)
            }),
            () =>
              Effect.sync(() => {
                const wakes = pubsub.durable.get(aggregateID)
                wakes?.delete(handle)
                if (wakes?.size === 0) pubsub.durable.delete(aggregateID)
              }).pipe(Effect.andThen(PubSub.shutdown(wake))),
          )
          // A subscriber created after the aggregate was removed would otherwise never
          // receive the terminal signal; complete its own deferred up front.
          if (removedAggregates.has(aggregateID)) yield* Deferred.succeed(removed, undefined)
          return { subscription, removed }
        })

      const durable = (input: { readonly aggregateID: string; readonly after?: number }): Stream.Stream<Payload> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const handle = yield* subscribeDurable(input.aggregateID)
            let sequence = input.after ?? -1
            // Pages the aggregate tail lazily; `sequence` advances as each page is consumed so
            // the live phase resumes at the drained tail without materializing the whole log.
            const readForward = (after: number): Stream.Stream<Payload> =>
              Stream.paginate<number, Payload>(after, (cursor) =>
                readPage(input.aggregateID, cursor).pipe(
                  Effect.tap((page) =>
                    Effect.sync(() => {
                      if (page.lastSeq !== undefined) sequence = page.lastSeq
                    }),
                  ),
                  Effect.map(
                    (page) =>
                      [
                        page.events,
                        page.full && page.lastSeq !== undefined ? Option.some(page.lastSeq) : Option.none(),
                      ] as const,
                  ),
                ),
              )
            const live = Stream.fromSubscription(handle.subscription).pipe(
              Stream.takeWhile((signal) => signal !== null),
              // Direct payload on seq+1; a coalesced gap falls back to an authoritative page read.
              Stream.flatMap((signal): Stream.Stream<Payload> => {
                if (signal === null) return Stream.empty
                const seq = signal.durable?.seq
                if (seq !== undefined && seq <= sequence) return Stream.empty
                if (seq !== undefined && seq === sequence + 1)
                  return Stream.fromEffect(
                    Effect.sync(() => {
                      sequence = seq
                      return signal
                    }),
                  )
                return readForward(sequence)
              }),
            )
            return Stream.concat(readForward(sequence), live).pipe(
              Stream.interruptWhen(Deferred.await(handle.removed)),
            )
          }),
        )

      const listen = (listener: Subscriber): Effect.Effect<Unsubscribe> =>
        Effect.sync(() => {
          listeners.push(listener)
          return Effect.sync(() => {
            const index = listeners.indexOf(listener)
            if (index >= 0) listeners.splice(index, 1)
          })
        })

      const project = <D extends Definition>(definition: D, projector: Subscriber<D>): Effect.Effect<void> =>
        Effect.sync(() => {
          const list = projectors.get(definition.type) ?? []
          list.push((event) => projector(event as Payload<D>))
          projectors.set(definition.type, list)
        })

      return Service.of({
        publish,
        subscribe,
        all: streamAll,
        durable,
        listen,
        project,
        replay,
        replayAll,
        remove,
        claim,
      })
    }),
  )

const layer = layerWith()
export const node = makeGlobalNode({ service: Service, layer: layer, deps: [Database.node] })
