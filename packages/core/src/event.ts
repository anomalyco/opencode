export * as EventV2 from "./event"

import { Cause, Context, Effect, Fiber, Layer, Option, PubSub, Queue, Schema, Semaphore, Stream } from "effect"
import { Event } from "@opencode-ai/schema/event"
import type { Data, Definition, Payload } from "@opencode-ai/schema/event"
import { and, asc, eq, gt, inArray } from "drizzle-orm"
import { Database } from "./database/database"
import { EventSequenceTable, EventTable } from "./event/sql"
import { Location } from "./location"
import { makeGlobalNode } from "./effect/app-node"
import { isDeepStrictEqual } from "node:util"
import { Durable } from "@opencode-ai/schema/durable-event-manifest"
import { EventExact } from "./event-exact"

export const ID = Event.ID
export type ID = import("@opencode-ai/schema/event").ID
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
  /** Instrumentation seam when a committed event enters durable aggregate-wake dispatch. */
  readonly beforeDurableWake?: (aggregateID: string) => Effect.Effect<void>
  /** Instrumentation seam after an exact commit/wake and before its Instance-owned notification attempt. */
  readonly beforeExactNotification?: (event: Payload) => Effect.Effect<void>
}

export const layerWith = (options?: LayerOptions) =>
  Layer.effectContext(
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
      const scope = yield* Effect.scope
      const exactLock = yield* Semaphore.make(1)
      const exactNotifications = new Map<ID, Fiber.Fiber<void, unknown>>()

      type ExactBinding = {
        readonly token: EventExact.Token
        readonly definition: Definition
        readonly event: Payload
        readonly aggregateID: string
        readonly encoded: Record<string, unknown>
        readonly type: string
        readonly authority: EventExact.Authority
        readonly expectedRow: unknown
        readonly retained?: EventExact.Coordinate
        readonly projector: Subscriber
        readonly commit?: PublishOptions["commit"]
      }

      const exactBindings = new WeakMap<object, ExactBinding>()

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
        },
        commit?: (seq: number) => Effect.Effect<void>,
        exact?: ExactBinding,
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

                          /**
                           * Exact publication is selected by an identity-checked object capability, not a replay
                           * sequence. Existing exact events cause no projector, commit, allocation, wake, or
                           * notification effect; collisions fail before mutation.
                           */
                          if (exact) {
                            if (
                              exact.aggregateID !== aggregateID ||
                              exact.type !== versionedType(definition.type, durable.version) ||
                              !isDeepStrictEqual(exact.encoded, encoded)
                            ) {
                              yield* Effect.die(
                                new InvalidDurableEventError({
                                  type: event.type,
                                  message: `Exact capability binding diverged for event ${event.id}`,
                                }),
                              )
                            }
                            const stored = yield* db
                              .select()
                              .from(EventTable)
                              .where(eq(EventTable.id, event.id))
                              .get()
                              .pipe(Effect.orDie)
                            if (stored) {
                              const retained = exact.retained
                              const same =
                                stored.aggregate_id === aggregateID &&
                                stored.type === exact.type &&
                                isDeepStrictEqual(stored.data, encoded) &&
                                (!retained ||
                                  (retained.aggregateID === stored.aggregate_id && retained.seq === stored.seq))
                              if (!same)
                                yield* Effect.die(
                                  new InvalidDurableEventError({
                                    type: event.type,
                                    message: `Event ${event.id} already exists at aggregate ${stored.aggregate_id} sequence ${stored.seq}`,
                                  }),
                                )
                              return {
                                status: "existing_exact" as const,
                                aggregateID: stored.aggregate_id,
                                seq: stored.seq,
                              }
                            }
                            const seq = latest + 1
                            const committed = {
                              ...event,
                              durable: { aggregateID, seq, version: durable.version },
                            } as Payload
                            yield* exact.projector(committed)
                            if (exact.commit) yield* exact.commit(seq)
                            yield* db
                              .insert(EventSequenceTable)
                              .values([{ aggregate_id: aggregateID, seq }])
                              .onConflictDoUpdate({ target: EventSequenceTable.aggregate_id, set: { seq } })
                              .run()
                              .pipe(Effect.orDie)
                            yield* db
                              .insert(EventTable)
                              .values([
                                {
                                  id: event.id,
                                  aggregate_id: aggregateID,
                                  seq,
                                  type: exact.type,
                                  data: encoded,
                                },
                              ])
                              .run()
                              .pipe(Effect.orDie)
                            return { status: "committed_new" as const, aggregateID, seq }
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
                              },
                            ])
                            .run()
                            .pipe(Effect.orDie)
                          return { aggregateID, seq }
                        }),
                      { behavior: "immediate" },
                    )
                    .pipe(Effect.orDie)
                  if (committed && (!("status" in committed) || committed.status === "committed_new")) {
                    yield* options?.beforeDurableWake?.(committed.aggregateID) ?? Effect.void
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
          yield* PubSub.publish(pubsub.all, event)
        })
      }

      function issueExact<D extends Definition>(input: EventExact.IssueInput<D>) {
        return Effect.gen(function* () {
          const durable = input.definition.durable
          if (!durable)
            return yield* Effect.die(
              new InvalidDurableEventError({
                type: input.definition.type,
                message: "Exact capabilities require a durable event",
              }),
            )
          const aggregateID = (input.data as Record<string, unknown>)[durable.aggregate]
          if (typeof aggregateID !== "string")
            return yield* Effect.die(
              new InvalidDurableEventError({
                type: input.definition.type,
                message: `Expected string aggregate field ${durable.aggregate}`,
              }),
            )
          const serviceLocation = Option.getOrUndefined(yield* Effect.serviceOption(Location.Service))
          const location = serviceLocation
            ? { directory: serviceLocation.directory, workspaceID: serviceLocation.workspaceID }
            : undefined
          const event = {
            id: input.id,
            type: input.definition.type,
            ...(location ? { location } : {}),
            data: input.data,
          } as Payload<D>
          const encoded = Schema.encodeUnknownSync(input.definition.data)(input.data) as Record<string, unknown>
          const token = Object.freeze({}) as EventExact.Token
          const binding: ExactBinding = Object.freeze({
            token,
            definition: input.definition,
            event,
            aggregateID,
            encoded,
            type: versionedType(input.definition.type, durable.version),
            authority: input.authority,
            expectedRow: input.expectedRow,
            retained: input.retained,
            projector: (committed) => input.projector(committed as Payload<D>),
            commit: input.commit,
          })
          exactBindings.set(token, binding)
          return token
        })
      }

      function publishExact<D extends Definition>(token: EventExact.Token) {
        return Effect.gen(function* () {
          const binding = exactBindings.get(token)
          if (!binding)
            return yield* Effect.die(
              new InvalidDurableEventError({ type: "unknown", message: "Invalid exact event capability" }),
            )

          /**
           * Commit and notification registration form one interruption-masked handoff under a private
           * semaphore.  A retry cannot observe the committed row until the Instance-owned notification
           * fiber is registered.  The listener work itself runs interruptibly in the layer scope; only
           * the registration window is masked.  Once the lock is released, caller interruption detaches
           * only this join and cannot cancel the retained fiber.
           */
          const prepared = yield* exactLock.withPermits(1)(
            Effect.uninterruptible(
              Effect.gen(function* () {
                const committed = yield* commitDurableEvent(
                  binding.definition,
                  binding.event,
                  undefined,
                  undefined,
                  binding,
                )
                if (!committed || !("status" in committed))
                  return yield* Effect.die(
                    new InvalidDurableEventError({
                      type: binding.event.type,
                      message: `Exact event ${binding.event.id} did not produce an exact commit result`,
                    }),
                  )
                const event = {
                  ...binding.event,
                  durable: {
                    aggregateID: committed.aggregateID,
                    seq: committed.seq,
                    version: binding.definition.durable!.version,
                  },
                } as Payload
                let notification = exactNotifications.get(binding.event.id)
                if (committed.status === "committed_new") {
                  if (notification)
                    return yield* Effect.die(
                      new InvalidDurableEventError({
                        type: binding.event.type,
                        message: `Exact notification already registered for new event ${binding.event.id}`,
                      }),
                    )
                  notification = yield* (options?.beforeExactNotification?.(event) ?? Effect.void).pipe(
                    Effect.andThen(notify(event, true)),
                    Effect.forkIn(scope, { startImmediately: true }),
                  )
                  exactNotifications.set(binding.event.id, notification)
                }
                return {
                  result: {
                    status: committed.status,
                    coordinate: { aggregateID: committed.aggregateID, seq: committed.seq },
                    event,
                  },
                  notification,
                }
              }),
            ),
          )
          if (prepared.notification) yield* Fiber.join(prepared.notification)
          return prepared.result as EventExact.PublishResult<D>
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

      const service = Service.of({
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
      const exact = EventExact.Service.of({ issue: issueExact, publish: publishExact })
      return Context.make(Service, service).pipe(Context.add(EventExact.Service, exact))
    }),
  )

const layer = layerWith()
export const node = makeGlobalNode({ service: Service, layer: layer, deps: [Database.node] })

