export * as EventV2 from "./event"

import { Cause, Context, Effect, Layer, Option, PubSub, Queue, Schema, Stream } from "effect"
import { Event } from "@opencode-ai/schema/event"
import type { Data, Definition, Payload } from "@opencode-ai/schema/event"
import { and, asc, desc, eq, gt, inArray, lt } from "drizzle-orm"
import { Database } from "./database/database"
import { EventSequenceTable, EventTable } from "./event/sql"
import { Location } from "./location"
import { makeGlobalNode } from "./effect/app-node"
import { isDeepStrictEqual } from "node:util"
import { Durable } from "@opencode-ai/schema/durable-event-manifest"

export const ID = Event.ID
export type ID = import("@opencode-ai/schema/event").ID
export type { Data, Definition, Payload } from "@opencode-ai/schema/event"

export type Subscriber<D extends Definition = Definition> = (event: Payload<D>) => Effect.Effect<void>
export type Unsubscribe = Effect.Effect<void>

/**
 * Extract the compaction key from an encoded event payload using a JSON path
 * like `$.sessionID` or `$.info.id`. Returns undefined if the path cannot be
 * resolved (the event then simply won't be compacted).
 */
function compactKeyValue(encoded: Record<string, unknown>, path: string): string | undefined {
  if (!path.startsWith("$.")) return undefined
  let current: unknown = encoded
  for (const segment of path.slice(2).split(".")) {
    if (typeof current !== "object" || current === null || !Object.hasOwn(current, segment)) return undefined
    current = Reflect.get(current, segment)
  }
  return typeof current === "string" ? current : undefined
}

/**
 * step-finish parts carry cumulative cost/token accounting: the projector
 * subtracts the stored part's usage before applying the replacement, so their
 * previous snapshot must survive. Exempt them from dedupe and compaction.
 */
const accountingPart = (encoded: Record<string, unknown>): boolean => {
  const part = encoded.part
  return typeof part === "object" && part !== null && Reflect.get(part, "type") === "step-finish"
}

/**
 * Deep equality that treats the listed `$`-prefixed dot paths as equal. Used to
 * recognize a snapshot whose only changes are volatile fields (streaming
 * timings) as a duplicate of the previous stored snapshot.
 */
function sameSnapshot(previous: unknown, next: unknown, ignore: ReadonlyArray<string>): boolean {
  const ignored = new Set(ignore)
  const walk = (left: unknown, right: unknown, path: string): boolean => {
    if (ignored.has(path)) return true
    if (left === right) return true
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
      // Dedupe paths cannot address array elements, so elements share the parent path.
      return left.every((value, index) => walk(value, right[index], path))
    }
    if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false
    const leftRecord = Object.entries(left)
    const rightEntries = Object.entries(right)
    if (leftRecord.length !== rightEntries.length) return false
    const rightRecord = new Map(rightEntries)
    return leftRecord.every(([key, value]) => rightRecord.has(key) && walk(value, rightRecord.get(key), `${path}.${key}`))
  }
  return walk(previous, next, "$")
}
export const latestSequence = Effect.fn("EventV2.latestSequence")(function* (
  db: Database.Interface["db"],
  aggregateID: string,
) {
  const row = yield* db
    .select({ seq: EventSequenceTable.seq })
    .from(EventSequenceTable)
    .where(eq(EventSequenceTable.aggregate_id, aggregateID))
    .get()
    .pipe(Effect.orDie)
  return row?.seq ?? -1
})

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

const decodeSerializedEvent = (event: SerializedEvent): Payload => {
  const definition = Durable.get(event.type)
  if (!definition?.durable) {
    throw new InvalidDurableEventError({ type: event.type, message: `Unknown durable event type ${event.type}` })
  }
  return {
    id: event.id,
    type: definition.type,
    durable: { aggregateID: event.aggregateID, seq: event.seq, version: definition.durable.version },
    data: Schema.decodeUnknownSync(definition.data)(event.data),
  }
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
  const decode = Schema.decodeUnknownSync(input.manifest.schema)
  const events = page.map((event) =>
    decode({
      id: event.id,
      type: input.manifest.definitions.get(event.type)?.type ?? event.type,
      durable: {
        aggregateID: event.aggregate_id,
        seq: event.seq,
        version: input.manifest.definitions.get(event.type)?.durable?.version,
      },
      data: event.data,
    }),
  )
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
  /** Local operational projection committed atomically with a new durable event. Not replayed or serialized. */
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

export const layerWith = (options?: LayerOptions) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const pubsub = {
        all: yield* PubSub.unbounded<Payload>(),
        durable: new Map<string, Set<PubSub.PubSub<void>>>(),
        typed: new Map<string, PubSub.PubSub<Payload>>(),
      }
      const projectors = new Map<string, Subscriber[]>()
      // TODO: Bind durable projectors to exact type+version before supporting incompatible historical payloads.
      const listeners = new Array<Subscriber>()
      const { db } = yield* Database.Service

      const getOrCreate = (definition: Definition) =>
        Effect.gen(function* () {
          const existing = pubsub.typed.get(definition.type)
          if (existing) return existing
          const created = yield* PubSub.unbounded<Payload>()
          pubsub.typed.set(definition.type, created)
          return created
        })

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* PubSub.shutdown(pubsub.all)
          yield* Effect.forEach(
            pubsub.durable.values(),
            (pubsubs) => Effect.forEach(pubsubs, PubSub.shutdown, { discard: true }),
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
          readonly allowGap?: boolean
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
              const list = projectors.get(event.type) ?? []
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
                            .pipe(Effect.orDie)
                          const latest = row?.seq ?? -1
                          const encoded = Schema.encodeUnknownSync(definition.data)(event.data) as Record<
                            string,
                            unknown
                          >
                          // Skip a live snapshot that repeats the stored one apart
                          // from volatile fields. Replay inputs and local commit
                          // hooks must always write, so they bypass this.
                          // When the comparison runs it also locates the previous
                          // stored snapshot for the entity; compaction reuses its
                          // sequence instead of rescanning every stored snapshot.
                          let supersededSeq: number | undefined
                          let compared = false
                          const accounting = accountingPart(encoded)
                          const compactKey = durable.compact && !accounting ? compactKeyValue(encoded, durable.compact) : undefined
                          if (!input && !commit && durable.dedupe?.length) {
                            // Without a compact path the aggregate is the entity;
                            // otherwise the snapshot only duplicates the stored one
                            // for the same entity, not merely the same aggregate.
                            if (durable.compact === undefined || compactKey !== undefined) {
                              const previous = yield* db
                                .select({ seq: EventTable.seq, data: EventTable.data })
                                .from(EventTable)
                                .where(
                                  and(
                                    eq(EventTable.aggregate_id, aggregateID),
                                    eq(EventTable.type, versionedType(definition.type, durable.version)),
                                    ...(compactKey === undefined
                                      ? []
                                      : [eq(EventTable.compact_key, compactKey)]),
                                  ),
                                )
                                .orderBy(desc(EventTable.seq))
                                .limit(1)
                                .get()
                                .pipe(Effect.orDie)
                              compared = true
                              // Skipping is only safe when the stored snapshot is
                              // also the aggregate's latest event: an intervening
                              // event (a part or message removal) may have changed
                              // the projected state, so the re-sent snapshot must
                              // be written to restore it.
                              if (previous && previous.seq === latest && sameSnapshot(previous.data, encoded, durable.dedupe)) return
                              supersededSeq = previous?.seq
                            }
                          }
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
                              .pipe(Effect.orDie)
                            if (
                              stored?.id === event.id &&
                              stored.type === versionedType(definition.type, durable.version) &&
                              isDeepStrictEqual(stored.data, encoded)
                            ) {
                              if (input.ownerID && row?.ownerID == null) {
                                yield* db
                                  .update(EventSequenceTable)
                                  .set({ owner_id: input.ownerID })
                                  .where(eq(EventSequenceTable.aggregate_id, aggregateID))
                                  .run()
                                  .pipe(Effect.orDie)
                              }
                              return
                            }
                            if (!stored && durable.compact) {
                              // Tolerate a row only if a newer snapshot of the same compact entity
                              // superseded it; a bare gap could equally be a lost or fabricated row.
                              const superseded =
                                compactKey !== undefined &&
                                (yield* db
                                  .select({ id: EventTable.id })
                                  .from(EventTable)
                                  .where(
                                    and(
                                      eq(EventTable.aggregate_id, aggregateID),
                                      eq(EventTable.type, versionedType(definition.type, durable.version)),
                                      gt(EventTable.seq, input.seq),
                                      eq(EventTable.compact_key, compactKey),
                                    ),
                                  )
                                  .get()
                                  .pipe(Effect.orDie))
                              if (superseded) return
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
                          // The divergence check above only covers seq <= latest;
                          // a forward jump silently advances the cursor past
                          // never-written sequences. It is only tolerated inside
                          // replayAll batches that verified ascending order across
                          // the whole history (compaction gaps), never for a
                          // single replayed event arriving over the wire.
                          if (input && seq !== latest + 1 && !input.allowGap) {
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
                            .pipe(Effect.orDie)
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
                            .pipe(Effect.orDie)
                          yield* db
                            .insert(EventTable)
                            .values([
                              {
                                id: event.id,
                                aggregate_id: aggregateID,
                                seq,
                                type: versionedType(definition.type, durable.version),
                                data: encoded,
                                compact_key: compactKey,
                              },
                            ])
                            .run()
                            .pipe(Effect.orDie)
                          if (durable.compact && !accounting) {
                            if (compactKey !== undefined) {
                              if (compared && supersededSeq !== undefined) {
                                // The dedupe comparison already located the previous
                                // snapshot for this entity; remove exactly that row
                                // instead of rescanning every stored snapshot.
                                // ponytail: single-row delete keeps live writes O(1);
                                // pre-compaction backlogs drain via replay/warp paths
                                // (full sweep below), not on every publish.
                                yield* db
                                  .delete(EventTable)
                                  .where(
                                    and(
                                      eq(EventTable.aggregate_id, aggregateID),
                                      eq(EventTable.seq, supersededSeq),
                                    ),
                                  )
                                  .run()
                                  .pipe(Effect.orDie)
                              } else if (!compared) {
                                // One indexed DELETE removes every older
                                // snapshot for this entity at once, which also
                                // drains the backlog left by databases upgraded
                                // from before compaction. Direct WHERE, no id
                                // list: a huge backlog must not hit the
                                // bind-variable ceiling.
                                yield* db
                                  .delete(EventTable)
                                  .where(
                                    and(
                                      eq(EventTable.aggregate_id, aggregateID),
                                      eq(EventTable.type, versionedType(definition.type, durable.version)),
                                      lt(EventTable.seq, seq),
                                      eq(EventTable.compact_key, compactKey),
                                    ),
                                  )
                                  .run()
                                  .pipe(Effect.orDie)
                              }
                            }
                          }
                          return { aggregateID, seq }
                        }),
                      { behavior: "immediate" },
                    )
                    .pipe(Effect.orDie)
                  if (committed) {
                    yield* Effect.forEach(
                      pubsub.durable.get(committed.aggregateID) ?? [],
                      (wake) => PubSub.publish(wake, undefined),
                      { discard: true },
                    )
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
            // Dedupe-skipped publish: nothing was written, but a dying
            // listener must not fail the caller either.
            yield* notify(event as Payload, true)
            return event
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

      // isolateListeners: dying listeners are logged instead of failing the
      // publish caller. Durable paths (committed or dedupe-skipped) isolate —
      // the write is done, a listener crash must not fail the publisher.
      // Live-only publishes stay fail-fast so broken listeners surface.
      function notify(event: Payload, isolateListeners: boolean) {
        return Effect.gen(function* () {
          yield* Effect.forEach(
            listeners,
            (listener) => (isolateListeners ? observe(event, listener) : listener(event)),
            { discard: true },
          )
          const typed = pubsub.typed.get(event.type)
          if (typed) yield* PubSub.publish(typed, event)
          yield* PubSub.publish(pubsub.all, event)
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
        options?: { readonly publish?: boolean; readonly ownerID?: string; readonly strictOwner?: boolean; readonly allowGap?: boolean },
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
              allowGap: options?.allowGap,
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
          let previous = start - 1
          for (const [index, event] of events.entries()) {
            if (event.seq <= previous) {
              yield* Effect.die(
                new InvalidDurableEventError({
                  type: event.type,
                  message: `Replay sequence mismatch at index ${index}: expected a sequence above ${previous}, got ${event.seq}`,
                }),
              )
            }
            previous = event.seq
          }
          // The batch verified ascending order, so forward jumps inside it are
          // compaction gaps, not a hostile cursor advance. Only compacted
          // types can legally have gaps — uncompacted rows are never deleted.
          for (const event of events) {
            const definition = Durable.get(event.type)
            yield* replay(event, {
              ...options,
              allowGap: definition?.durable?.compact !== undefined,
            })
          }
          return source
        })
      }

      function remove(aggregateID: string) {
        return db
          .transaction(() =>
            Effect.gen(function* () {
              yield* db.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, aggregateID)).run()
              yield* db.delete(EventTable).where(eq(EventTable.aggregate_id, aggregateID)).run()
            }),
          )
          .pipe(Effect.orDie)
      }

      function claim(aggregateID: string, ownerID: string) {
        return db
          .update(EventSequenceTable)
          .set({ owner_id: ownerID })
          .where(eq(EventSequenceTable.aggregate_id, aggregateID))
          .run()
          .pipe(Effect.orDie)
      }

      const subscribe = <D extends Definition>(definition: D): Stream.Stream<Payload<D>> =>
        Stream.unwrap(getOrCreate(definition).pipe(Effect.map((pubsub) => Stream.fromPubSub(pubsub)))).pipe(
          Stream.map((event) => event as Payload<D>),
        )

      const streamAll = (): Stream.Stream<Payload> => Stream.fromPubSub(pubsub.all)

      const readAfter = (aggregateID: string, after: number) =>
        (options?.beforeAggregateRead?.(aggregateID) ?? Effect.void).pipe(
          Effect.andThen(
            db
              .select()
              .from(EventTable)
              .where(and(eq(EventTable.aggregate_id, aggregateID), gt(EventTable.seq, after)))
              .orderBy(asc(EventTable.seq))
              .all(),
          ),
          Effect.orDie,
          Effect.map((rows) =>
            rows.map((event) =>
              decodeSerializedEvent({
                id: event.id,
                aggregateID: event.aggregate_id,
                seq: event.seq,
                type: event.type,
                data: event.data,
              }),
            ),
          ),
        )

      const subscribeDurable = (aggregateID: string) =>
        Effect.gen(function* () {
          const wake = yield* PubSub.sliding<void>(1)
          const subscription = yield* PubSub.subscribe(wake)
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const wakes = pubsub.durable.get(aggregateID) ?? new Set()
              wakes.add(wake)
              pubsub.durable.set(aggregateID, wakes)
            }),
            () =>
              Effect.sync(() => {
                const wakes = pubsub.durable.get(aggregateID)
                wakes?.delete(wake)
                if (wakes?.size === 0) pubsub.durable.delete(aggregateID)
              }).pipe(Effect.andThen(PubSub.shutdown(wake))),
          )
          return subscription
        })

      const durable = (input: { readonly aggregateID: string; readonly after?: number }): Stream.Stream<Payload> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const wakes = yield* subscribeDurable(input.aggregateID)
            let sequence = input.after ?? -1
            const read = Effect.suspend(() => readAfter(input.aggregateID, sequence)).pipe(
              Effect.tap((events) =>
                Effect.sync(() => {
                  sequence = events.at(-1)?.durable?.seq ?? sequence
                }),
              ),
            )
            const historical = yield* read
            const live = Stream.fromSubscription(wakes).pipe(
              Stream.mapEffect(() => read),
              Stream.flattenIterable,
            )
            return Stream.concat(Stream.fromIterable(historical), live)
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
