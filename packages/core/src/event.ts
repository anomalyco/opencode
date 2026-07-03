export * as EventV2 from "./event"

import { Cause, Context, Effect, Layer, Option, PubSub, Queue, Schema, Stream } from "effect"
import { Event } from "@opencode-ai/schema/event"
import type { Data, Definition, Payload } from "@opencode-ai/schema/event"
import type { EventLog } from "@opencode-ai/schema/event-log"
import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm"
import { Database } from "./database/database"
import { EventSequenceTable, EventTable } from "./event/sql"
import { Location } from "./location"
import { makeGlobalNode } from "./effect/app-node"
import { isDeepStrictEqual } from "node:util"
import { Durable } from "@opencode-ai/schema/durable-event-manifest"

export const ID = Event.ID
export type ID = import("@opencode-ai/schema/event").ID
export const Seq = Event.Seq
export type Seq = import("@opencode-ai/schema/event").Seq
export const Version = Event.Version
export type Version = import("@opencode-ai/schema/event").Version
export type { Data, Definition, Payload } from "@opencode-ai/schema/event"

export type Subscriber<D extends Definition = Definition> = (event: Payload<D>) => Effect.Effect<void>
export type Unsubscribe = Effect.Effect<void>

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

export const reserveSequence = Effect.fn("EventV2.reserveSequence")(function* (
  db: Database.Interface["db"],
  aggregateID: string,
  seq: number,
) {
  yield* db
    .insert(EventSequenceTable)
    .values([{ aggregate_id: aggregateID, seq }])
    .onConflictDoUpdate({
      target: EventSequenceTable.aggregate_id,
      set: { seq: sql`max(${EventSequenceTable.seq}, ${seq})` },
    })
    .run()
    .pipe(Effect.orDie)
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

const envelope = (aggregateID: string, seq: number, version: number) => ({
  aggregateID,
  seq: Seq.make(seq),
  version: Version.make(version),
})

const decodeSerializedEvent = (event: SerializedEvent): Payload => {
  const definition = Durable.get(event.type)
  if (!definition?.durable) {
    throw new InvalidDurableEventError({ type: event.type, message: `Unknown durable event type ${event.type}` })
  }
  return {
    id: event.id,
    type: definition.type,
    durable: envelope(event.aggregateID, event.seq, definition.durable.version),
    data: Schema.decodeUnknownSync(definition.data)(event.data),
  }
}

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

/** Marker/event union emitted by `log`. */
export type LogItem = Payload | EventLog.Synced

export const isSynced = (item: LogItem): item is EventLog.Synced => item.type === "log.synced"

export interface Interface {
  readonly publish: <D extends Definition>(
    definition: D,
    data: Data<D>,
    options?: PublishOptions,
  ) => Effect.Effect<Payload<D>>
  readonly subscribe: <D extends Definition>(definition: D) => Stream.Stream<Payload<D>>
  /**
   * Volatile live channel: every event published from now on, nothing before,
   * nothing across a disconnect. The only channel that carries non-durable
   * events; consumers that need reliability combine `changes` with `log`.
   */
  readonly live: () => Stream.Stream<Payload>
  /**
   * Durable, ordered, gap-free per-aggregate log read. `follow: false`
   * completes at the end of the log; `follow: true` replays then transitions
   * to live. Both modes emit one `Synced` marker at the captured replay
   * watermark.
   */
  readonly log: (input: {
    readonly aggregateID: string
    readonly after?: number
    readonly follow?: boolean
  }) => Stream.Stream<LogItem>
  /**
   * Coalescing hint channel: latest committed seq per aggregate, never a
   * delivery guarantee. Emits `SweepRequired` first on every subscribe and
   * whenever per-key retention is exceeded. Never fails under backpressure.
   */
  readonly changes: () => Stream.Stream<EventLog.Change>
  /** Latest committed seq per aggregate. Aggregates without events are absent. */
  readonly sequences: (aggregateIDs: ReadonlyArray<string>) => Effect.Effect<ReadonlyMap<string, Seq>>
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

export const liveBounded = (events: Interface, capacity: number) =>
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
  /**
   * Maximum distinct aggregates buffered per changes subscriber before the
   * buffer is abandoned and the subscriber is told to sweep.
   */
  readonly changesKeyCapacity?: number
  /** Maximum durable rows read per page while replaying or tailing an aggregate log. */
  readonly logReadPageSize?: number
}

export const layerWith = (options?: LayerOptions) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const pubsub = {
        live: yield* PubSub.unbounded<Payload>(),
        durable: new Map<string, Set<PubSub.PubSub<void>>>(),
        typed: new Map<string, PubSub.PubSub<Payload>>(),
      }
      const projectors = new Map<string, Subscriber[]>()
      // TODO: Bind durable projectors to exact type+version before supporting incompatible historical payloads.
      const listeners = new Array<Subscriber>()
      const changesKeyCapacity = options?.changesKeyCapacity ?? 4096
      const changesSubscribers = new Set<{
        readonly hints: Map<string, number>
        sweepRequired: boolean
        readonly wake: PubSub.PubSub<void>
      }>()
      const { db } = yield* Database.Service
      const logReadPageSize = options?.logReadPageSize ?? 512

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
          yield* PubSub.shutdown(pubsub.live)
          yield* Effect.forEach(
            pubsub.durable.values(),
            (pubsubs) => Effect.forEach(pubsubs, PubSub.shutdown, { discard: true }),
            { discard: true },
          )
          yield* Effect.forEach(pubsub.typed.values(), PubSub.shutdown, { discard: true })
          yield* Effect.forEach(changesSubscribers, (subscriber) => PubSub.shutdown(subscriber.wake), {
            discard: true,
          })
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
                                seq: sql`max(${EventSequenceTable.seq}, ${seq})`,
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
                              },
                            ])
                            .run()
                            .pipe(Effect.orDie)
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
                    yield* Effect.forEach(
                      changesSubscribers,
                      (subscriber) =>
                        Effect.sync(() => {
                          // Coalesce to the latest seq per aggregate. Overflowing key
                          // cardinality abandons the buffer instead of dropping hints silently.
                          if (
                            subscriber.hints.size >= changesKeyCapacity &&
                            !subscriber.hints.has(committed.aggregateID)
                          ) {
                            subscriber.hints.clear()
                            subscriber.sweepRequired = true
                          } else if (!subscriber.sweepRequired) {
                            subscriber.hints.set(
                              committed.aggregateID,
                              Math.max(subscriber.hints.get(committed.aggregateID) ?? -1, committed.seq),
                            )
                          }
                        }).pipe(Effect.andThen(PubSub.publish(subscriber.wake, undefined)), Effect.asVoid),
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
                durable: envelope(committed.aggregateID, committed.seq, definition.durable.version),
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
          yield* Effect.forEach(
            listeners,
            (listener) => (isolateListeners ? observe(event, listener) : listener(event)),
            { discard: true },
          )
          const typed = pubsub.typed.get(event.type)
          if (typed) yield* PubSub.publish(typed, event)
          yield* PubSub.publish(pubsub.live, event)
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
                  durable: envelope(committed.aggregateID, committed.seq, definition.durable.version),
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

      const streamLive = (): Stream.Stream<Payload> => Stream.fromPubSub(pubsub.live)

      const readAfter = (
        aggregateID: string,
        after: number,
        input: { readonly through: number; readonly limit: number },
      ) =>
        (options?.beforeAggregateRead?.(aggregateID) ?? Effect.void).pipe(
          Effect.andThen(
            Effect.suspend(() => {
              const query = db
                .select()
                .from(EventTable)
                .where(
                  and(
                    eq(EventTable.aggregate_id, aggregateID),
                    gt(EventTable.seq, after),
                    lte(EventTable.seq, input.through),
                  ),
                )
                .orderBy(asc(EventTable.seq))
              return query.limit(input.limit).all()
            }),
          ),
          Effect.orDie,
          // Skip types missing from the durable manifest instead of failing the
          // read: the aggregate may hold events this process cannot decode. The
          // raw tail seq keeps cursors advancing across the resulting gaps.
          Effect.map((rows) => ({
            seq: rows.at(-1)?.seq,
            events: rows.flatMap((event) => {
              if (!Durable.get(event.type)?.durable) return []
              return [
                decodeSerializedEvent({
                  id: event.id,
                  aggregateID: event.aggregate_id,
                  seq: event.seq,
                  type: event.type,
                  data: event.data,
                }),
              ]
            }),
          })),
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

      const log = (input: {
        readonly aggregateID: string
        readonly after?: number
        readonly follow?: boolean
      }): Stream.Stream<LogItem> =>
        Stream.unwrap(
          Effect.gen(function* () {
            let sequence = input.after ?? -1
            const readThrough = (through: number): Stream.Stream<Payload> =>
              Stream.paginate(sequence, (cursor) =>
                readAfter(input.aggregateID, cursor, { through, limit: logReadPageSize }).pipe(
                  Effect.tap((page) =>
                    Effect.sync(() => {
                      sequence = page.seq ?? sequence
                    }),
                  ),
                  Effect.map(
                    (page) =>
                      [
                        page.events,
                        page.seq !== undefined && page.seq < through ? Option.some(page.seq) : Option.none<number>(),
                      ] as const,
                  ),
                ),
              )
            // Subscribing before the historical read means events committed during
            // replay either appear in the read or arrive through a post-marker wake.
            const wakes = input.follow ? yield* subscribeDurable(input.aggregateID) : undefined
            const target = yield* latestSequence(db, input.aggregateID)
            const marker: EventLog.Synced = {
              type: "log.synced",
              aggregateID: input.aggregateID,
              ...(target >= 0 ? { seq: Seq.make(target) } : {}),
            }
            const replay: Stream.Stream<LogItem> = readThrough(target).pipe(
              Stream.map((event): LogItem => event),
              Stream.concat(Stream.make(marker)),
            )
            if (!wakes) return replay
            const live: Stream.Stream<LogItem> = Stream.fromSubscription(wakes).pipe(
              Stream.mapEffect(() => latestSequence(db, input.aggregateID)),
              Stream.filter((target) => target > sequence),
              Stream.flatMap((target) => readThrough(target)),
              Stream.map((event): LogItem => event),
            )
            return Stream.concat(replay, live)
          }),
        )

      const changes = (): Stream.Stream<EventLog.Change> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const wake = yield* PubSub.sliding<void>(1)
            const subscription = yield* PubSub.subscribe(wake)
            const subscriber = { hints: new Map<string, number>(), sweepRequired: false, wake }
            yield* Effect.acquireRelease(
              Effect.sync(() => changesSubscribers.add(subscriber)),
              () =>
                Effect.sync(() => changesSubscribers.delete(subscriber)).pipe(
                  Effect.andThen(PubSub.shutdown(wake)),
                  Effect.asVoid,
                ),
            )
            const drain = Effect.sync((): ReadonlyArray<EventLog.Change> => {
              if (subscriber.sweepRequired) {
                subscriber.sweepRequired = false
                subscriber.hints.clear()
                return [{ type: "log.sweep_required" }]
              }
              const hints = Array.from(
                subscriber.hints,
                ([aggregateID, seq]): EventLog.Change => ({ type: "log.hint", aggregateID, seq: Seq.make(seq) }),
              )
              subscriber.hints.clear()
              return hints
            })
            // Hints missed while unsubscribed were never buffered, so every
            // (re)subscribe starts from the sweep contract.
            const initial: EventLog.Change = { type: "log.sweep_required" }
            return Stream.make(initial).pipe(
              Stream.concat(
                Stream.fromSubscription(subscription).pipe(
                  Stream.mapEffect(() => drain),
                  Stream.flattenIterable,
                ),
              ),
            )
          }),
        )

      const sequences = (aggregateIDs: ReadonlyArray<string>): Effect.Effect<ReadonlyMap<string, Seq>> => {
        if (aggregateIDs.length === 0) return Effect.succeed(new Map())
        return db
          .select({ aggregateID: EventSequenceTable.aggregate_id, seq: EventSequenceTable.seq })
          .from(EventSequenceTable)
          .where(inArray(EventSequenceTable.aggregate_id, Array.from(aggregateIDs)))
          .all()
          .pipe(
            Effect.orDie,
            Effect.map((rows) => new Map(rows.map((row) => [row.aggregateID, Seq.make(row.seq)]))),
          )
      }

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
        live: streamLive,
        log,
        changes,
        sequences,
        listen,
        project,
        replay,
        replayAll,
        remove,
        claim,
      })
    }),
  )

export const layer = layerWith()
export const node = makeGlobalNode({ service: Service, layer: layer, deps: [Database.node] })
