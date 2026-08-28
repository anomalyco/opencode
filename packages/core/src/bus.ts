export * as Bus from "./bus.js"

import { Cause, Clock, Context, Effect, Layer, Option, PubSub, Schema, Stream } from "effect"
import { Event } from "@opencode-ai/schema/event"
import type { EventLog } from "@opencode-ai/schema/event-log"
import { and, asc, eq, gt, lte, sql } from "drizzle-orm"
import { Database } from "./database/database.js"
import { EventSequenceTable, EventTable } from "./event/sql.js"
import type { Instance } from "./instance.js"
import type { Location } from "@opencode-ai/schema/location"
import { KeyedMutex } from "./effect/keyed-mutex.js"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { isDeepStrictEqual } from "node:util"
import { Durable } from "@opencode-ai/schema/durable-event-manifest"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import type { SessionID } from "@opencode-ai/schema/session-id"
import { AbsolutePath } from "@opencode-ai/schema/schema"

export type Subscriber<D extends Event.Definition = Event.Definition> = (event: Event.Payload<D>) => Effect.Effect<void>
export type Unsubscribe = Effect.Effect<void>

export const latestSequence = Effect.fn("Bus.latestSequence")(function* (
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

export const reserveSequence = Effect.fn("Bus.reserveSequence")(function* (
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
  readonly id: Event.ID
  readonly type: string
  readonly created?: number
  readonly seq: number
  readonly aggregateID: string
  readonly data: Record<string, unknown>
}

export class InvalidDurableEventError extends Schema.TaggedError<InvalidDurableEventError>()(
  "Bus.InvalidDurableEvent",
  {
    type: Schema.String,
    message: Schema.String,
  },
) {}

const envelope = (aggregateID: string, seq: number, version: number) => ({
  aggregateID,
  seq: Event.Seq.make(seq),
  version: Event.Version.make(version),
})

const decodeSerializedEvent = (event: SerializedEvent): Event.Payload => {
  const definition = Durable.get(event.type)
  if (!definition?.durable) {
    throw new InvalidDurableEventError({ type: event.type, message: `Unknown durable event type ${event.type}` })
  }
  return {
    id: event.id,
    created: event.created ?? 0,
    type: definition.type,
    durable: envelope(event.aggregateID, event.seq, definition.durable.version),
    data: Schema.decodeUnknownSync(definition.data)(event.data),
  }
}

export const versionedType = Event.versionedType
export const durable = Event.durable
export const ephemeral = Event.ephemeral

export interface PublishOptions {
  readonly id?: Event.ID
  readonly metadata?: Record<string, unknown>
  readonly location?: Location.Ref
  readonly global?: boolean
  /** Local operational projection committed atomically with a new durable event. Not replayed or serialized. */
  readonly commit?: (seq: number) => Effect.Effect<void>
}

export type PublishInput<D extends Event.DurableDefinition = Event.DurableDefinition> = readonly [
  definition: D,
  data: Event.Data<D>,
  options?: PublishOptions,
]

export type PublishResult<I extends readonly PublishInput[]> = {
  readonly [K in keyof I]: I[K] extends PublishInput<infer D> ? Event.Payload<D> : never
}

/** Marker/event union emitted by `log`. */
export type LogItem = Event.Payload | EventLog.Synced

export const isSynced = (item: LogItem): item is EventLog.Synced => item.type === "log.synced"

export type SubscribePayload<D extends readonly Event.Definition[]> = D[number] extends infer Item
  ? Item extends Event.Definition
    ? Event.Payload<Item>
    : never
  : never

export interface Subscribe {
  /**
   * Volatile live channel: every event published from now on, nothing before or
   * across a disconnect. Consumers that need reliability combine it with `log`.
   * With an ambient Location, delivery is restricted to that Location and global
   * events. Unlocated Session events use the Session's owner at publication time.
   * Session moves reach both the old and new Location, without changing the event.
   */
  (): Stream.Stream<Event.Payload>
  <D extends Event.Definition>(definition: D): Stream.Stream<Event.Payload<D>>
  <const D extends readonly [Event.Definition, ...Event.Definition[]]>(
    definitions: D,
  ): Stream.Stream<SubscribePayload<D>>
}

const isDefinition = (input: Event.Definition | readonly Event.Definition[]): input is Event.Definition =>
  !Array.isArray(input)

export interface Interface {
  readonly publish: <D extends Event.Definition>(
    definition: D,
    data: Event.Data<D>,
    options?: PublishOptions,
  ) => Effect.Effect<Event.Payload<D>>
  readonly publishAll: <const I extends readonly [PublishInput, ...PublishInput[]]>(
    events: I,
  ) => Effect.Effect<PublishResult<I>>
  readonly subscribe: Subscribe
  /**
   * Durable, ordered per-aggregate log read. Forked aggregates may reserve an
   * inherited prefix before their first child-authored event. `follow: false`
   * completes at the end of the log; `follow: true` replays then transitions
   * to live. Both modes emit one `Synced` marker at the captured replay
   * watermark.
   */
  readonly log: (input: {
    readonly aggregateID: string
    readonly after?: number
    readonly follow?: boolean
  }) => Stream.Stream<LogItem>
  /** @deprecated Use `subscribe()` and consume the returned stream. */
  readonly listen: (listener: Subscriber) => Effect.Effect<Unsubscribe>
  readonly project: <D extends Event.Definition>(definition: D, projector: Subscriber<D>) => Effect.Effect<void>
  readonly replay: (
    event: SerializedEvent,
    options?: { readonly publish?: boolean; readonly ownerID?: string; readonly strictOwner?: boolean },
  ) => Effect.Effect<void>
  readonly remove: (aggregateID: string) => Effect.Effect<void>
  readonly claim: (aggregateID: string, ownerID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Bus") {}

interface Options {
  readonly beforeAggregateRead?: (aggregateID: string) => Effect.Effect<void>
  /** Maximum durable rows read per page while replaying or tailing an aggregate log. */
  readonly logReadPageSize?: number
  /** Retain durable event payloads for historical log reads and replay. */
  readonly persist?: boolean
}

export function configured(options?: Options) {
  return makeGlobalNode({
    service: Service,
    deps: [Database.node],
    layer: Layer.effect(
      Service,
      Effect.gen(function* () {
        // Deferred import: a static one would close the module cycle
        // bus → location → project → bus and hit the node bindings in TDZ.
        const { Location } = yield* Effect.promise(() => import("./location.js"))
        const { SessionTable } = yield* Effect.promise(() => import("./session/sql.js"))
        const pubsub = {
          live: yield* PubSub.unbounded<Event.Payload>(),
          durable: new Map<string, Set<PubSub.PubSub<void>>>(),
          typed: new Map<string, PubSub.PubSub<Event.Payload>>(),
        }
        const projectors = new Map<string, Subscriber[]>()
        const listeners = new Array<Subscriber>()
        const durableLocks = KeyedMutex.makeUnsafe<string>()
        const { db } = yield* Database.Service
        const logReadPageSize = options?.logReadPageSize ?? 512
        const persist = options?.persist ?? false
        const sessions = new Map<SessionID, Instance.Key>()
        // Keep routing separate from the public event, and retain its snapshot
        // while a slow subscriber drains events queued before a move or deletion.
        const routes = new WeakMap<Event.Payload, readonly Instance.Key[]>()

        const isSessionEvent = (event: Event.Payload): event is SessionEvent.Event =>
          Object.hasOwn(SessionEvent.All.cases, event.type)

        const prepareRoutes = Effect.fnUntraced(function* (events: readonly Event.Payload[]) {
          const updates = new Map<SessionID, Instance.Key | undefined>()
          const resolved = new Map<Event.Payload, readonly Instance.Key[]>()
          for (const event of events) {
            if (!isSessionEvent(event)) continue
            const id = event.data.sessionID
            if (event.type === "session.created") {
              updates.set(id, Location.instanceKey(event.data.location))
              resolved.set(event, [Location.instanceKey(event.location ?? event.data.location)])
              continue
            }
            if (event.location && event.type !== "session.forked" && event.type !== "session.moved") {
              if (event.type === "session.deleted") updates.set(id, undefined)
              continue
            }
            const owner = event.type === "session.forked" ? event.data.parentID : id
            let key = updates.has(owner) ? updates.get(owner) : sessions.get(owner)
            if (!key && !updates.has(owner)) {
              const row = yield* db
                .select({ directory: SessionTable.directory, workspaceID: SessionTable.workspace_id })
                .from(SessionTable)
                .where(eq(SessionTable.id, owner))
                .get()
                .pipe(Effect.orDie)
              key = row
                ? Location.instanceKey({
                    directory: AbsolutePath.make(row.directory),
                    workspaceID: row.workspaceID ?? undefined,
                  })
                : undefined
              updates.set(owner, key)
            }
            if (event.type === "session.moved") {
              // Both owners need the transition, even if the producer supplied
              // an envelope location. Later events use only the destination.
              const destination = Location.instanceKey(event.data.location)
              updates.set(id, destination)
              resolved.set(event, key ? [key, destination] : [destination])
              continue
            }
            if (event.type === "session.forked") updates.set(id, key)
            resolved.set(event, event.location ? [Location.instanceKey(event.location)] : key ? [key] : [])
            if (event.type === "session.deleted") updates.set(id, undefined)
          }
          // Apply only after the projection transaction commits. A failed move
          // must not redirect events away from the Session's actual instance.
          return () => {
            for (const [id, key] of updates) {
              if (key) sessions.set(id, key)
              else sessions.delete(id)
            }
            for (const [event, keys] of resolved) routes.set(event, keys)
          }
        })

        const getOrCreate = (definition: Event.Definition) =>
          Effect.gen(function* () {
            const existing = pubsub.typed.get(definition.type)
            if (existing) return existing
            const created = yield* PubSub.unbounded<Event.Payload>()
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
          }),
        )

        function commitDurableEvent(
          definition: Event.Definition,
          event: Event.Payload,
          input?: {
            readonly seq: number
            readonly aggregateID: string
            readonly ownerID?: string
            readonly strictOwner?: boolean
          },
          commit?: (seq: number) => Effect.Effect<void>,
        ) {
          return Effect.gen(function* () {
            const durable = definition.durable
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
                const list = projectors.get(versionedType(definition.type, durable.version)) ?? []
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
                              if (!persist) return
                              const stored = yield* db
                                .select()
                                .from(EventTable)
                                .where(and(eq(EventTable.aggregate_id, aggregateID), eq(EventTable.seq, input.seq)))
                                .get()
                                .pipe(Effect.orDie)
                              if (
                                stored?.id === event.id &&
                                stored.type === versionedType(definition.type, durable.version) &&
                                stored.created === (event.created ?? 0) &&
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
                            if (persist) {
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
                            }
                            const committed = {
                              ...event,
                              durable: { aggregateID, seq, version: durable.version },
                            } as Event.Payload
                            const route = yield* prepareRoutes([committed])
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
                            if (persist)
                              yield* db
                                .insert(EventTable)
                                .values([
                                  {
                                    id: event.id,
                                    aggregate_id: aggregateID,
                                    seq,
                                    created: event.created ?? 0,
                                    type: versionedType(definition.type, durable.version),
                                    data: encoded,
                                  },
                                ])
                                .run()
                                .pipe(Effect.orDie)
                            return { aggregateID, seq, event: committed, route }
                          }),
                        { behavior: "immediate" },
                      )
                      .pipe(Effect.orDie)
                    if (committed) {
                      committed.route()
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

        function publishEvent<D extends Event.Definition>(
          definition: D,
          event: Event.Payload<D>,
          commit?: PublishOptions["commit"],
        ) {
          return Effect.gen(function* () {
            if (!definition.durable && commit)
              return yield* Effect.die(
                new InvalidDurableEventError({
                  type: event.type,
                  message: "Local commit hooks require a durable event",
                }),
              )
            if (definition.durable) {
              const aggregateID = (event.data as Record<string, unknown>)[definition.durable.aggregate]
              if (typeof aggregateID !== "string")
                return yield* commitDurableEvent(definition, event as Event.Payload, undefined, commit).pipe(
                  Effect.as(event),
                )
              return yield* durableLocks.withLock(aggregateID)(
                Effect.gen(function* () {
                  const committed = yield* commitDurableEvent(definition, event as Event.Payload, undefined, commit)
                  if (!committed) return event
                  event = committed.event as Event.Payload<D>
                  yield* notify(event as Event.Payload, true)
                  return event
                }),
              )
            }
            const route = yield* prepareRoutes([event as Event.Payload])
            route()
            yield* notify(event as Event.Payload, false)
            return event
          })
        }

        const observe = (event: Event.Payload, observer: (event: Event.Payload) => Effect.Effect<void>) =>
          Effect.suspend(() => observer(event)).pipe(
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterrupts(cause),
              (cause) => Effect.logError("Event listener failed", { eventID: event.id, eventType: event.type, cause }),
            ),
          )

        function notify(event: Event.Payload, isolateListeners: boolean) {
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

        function publish<D extends Event.Definition>(definition: D, data: Event.Data<D>, options?: PublishOptions) {
          return Effect.gen(function* () {
            const serviceLocation = Option.getOrUndefined(yield* Effect.serviceOption(Location.Service))
            const location = options?.global
              ? undefined
              : (options?.location ??
                (serviceLocation
                  ? { directory: serviceLocation.directory, workspaceID: serviceLocation.workspaceID }
                  : undefined))
            return yield* publishEvent(
              definition,
              {
                id: options?.id ?? Event.ID.create(),
                created: yield* Clock.currentTimeMillis,
                ...(options?.metadata ? { metadata: options.metadata } : {}),
                type: definition.type,
                ...(location ? { location } : {}),
                data,
              } as Event.Payload<D>,
              options?.commit,
            )
          })
        }

        function publishAll<const I extends readonly [PublishInput, ...PublishInput[]]>(events: I) {
          return Effect.gen(function* () {
            const serviceLocation = Option.getOrUndefined(yield* Effect.serviceOption(Location.Service))
            const payloads = yield* Effect.forEach(events, ([definition, data, options]) =>
              Effect.gen(function* () {
                const aggregateID = (data as Record<string, unknown>)[definition.durable.aggregate]
                if (typeof aggregateID !== "string") {
                  return yield* Effect.die(
                    new InvalidDurableEventError({
                      type: definition.type,
                      message: `Expected string aggregate field ${definition.durable.aggregate}`,
                    }),
                  )
                }
                const location = options?.global
                  ? undefined
                  : (options?.location ??
                    (serviceLocation
                      ? { directory: serviceLocation.directory, workspaceID: serviceLocation.workspaceID }
                      : undefined))
                return {
                  definition,
                  aggregateID,
                  commit: options?.commit,
                  event: {
                    id: options?.id ?? Event.ID.create(),
                    created: yield* Clock.currentTimeMillis,
                    ...(options?.metadata ? { metadata: options.metadata } : {}),
                    type: definition.type,
                    ...(location ? { location } : {}),
                    data,
                  } as Event.Payload,
                }
              }),
            )
            const aggregateID = payloads[0].aggregateID
            if (payloads.some((item) => item.aggregateID !== aggregateID)) {
              return yield* Effect.die(
                new InvalidDurableEventError({
                  type: payloads[0].definition.type,
                  message: "Published events must belong to the same aggregate",
                }),
              )
            }
            return yield* durableLocks.withLock(aggregateID)(
              Effect.uninterruptible(
                Effect.gen(function* () {
                  const committed = yield* db
                    .transaction(
                      () =>
                        Effect.gen(function* () {
                          const row = yield* db
                            .select({ seq: EventSequenceTable.seq })
                            .from(EventSequenceTable)
                            .where(eq(EventSequenceTable.aggregate_id, aggregateID))
                            .get()
                            .pipe(Effect.orDie)
                          const firstSeq = (row?.seq ?? -1) + 1
                          const finalSeq = firstSeq + payloads.length - 1
                          const queued = payloads.map((item, index) => ({
                            ...item.event,
                            durable: envelope(aggregateID, firstSeq + index, item.definition.durable.version),
                          }))
                          const route = yield* prepareRoutes(queued)
                          const rows = new Array<typeof EventTable.$inferInsert>()
                          const ids = new Set<Event.ID>()
                          for (const [index, item] of payloads.entries()) {
                            const seq = firstSeq + index
                            const encoded = Schema.encodeUnknownSync(item.definition.data)(item.event.data) as Record<
                              string,
                              unknown
                            >
                            if (persist) {
                              if (ids.has(item.event.id))
                                yield* Effect.die(
                                  new InvalidDurableEventError({
                                    type: item.event.type,
                                    message: `Event ${item.event.id} appears more than once in the batch`,
                                  }),
                                )
                              ids.add(item.event.id)
                              const stored = yield* db
                                .select({ aggregateID: EventTable.aggregate_id, seq: EventTable.seq })
                                .from(EventTable)
                                .where(eq(EventTable.id, item.event.id))
                                .get()
                                .pipe(Effect.orDie)
                              if (stored)
                                yield* Effect.die(
                                  new InvalidDurableEventError({
                                    type: item.event.type,
                                    message: `Event ${item.event.id} already exists at aggregate ${stored.aggregateID} sequence ${stored.seq}`,
                                  }),
                                )
                            }
                            const event = queued[index]
                            for (const projector of projectors.get(
                              versionedType(item.definition.type, item.definition.durable.version),
                            ) ?? []) {
                              yield* projector(event)
                            }
                            if (item.commit) yield* item.commit(seq)
                            if (persist)
                              rows.push({
                                id: event.id,
                                aggregate_id: aggregateID,
                                seq,
                                created: event.created,
                                type: versionedType(item.definition.type, item.definition.durable.version),
                                data: encoded,
                              })
                          }
                          yield* db
                            .insert(EventSequenceTable)
                            .values([{ aggregate_id: aggregateID, seq: finalSeq }])
                            .onConflictDoUpdate({ target: EventSequenceTable.aggregate_id, set: { seq: finalSeq } })
                            .run()
                            .pipe(Effect.orDie)
                          if (persist) yield* db.insert(EventTable).values(rows).run().pipe(Effect.orDie)
                          return { events: queued, route }
                        }),
                      { behavior: "immediate" },
                    )
                    .pipe(Effect.orDie)
                  committed.route()
                  yield* Effect.forEach(
                    pubsub.durable.get(aggregateID) ?? [],
                    (wake) => PubSub.publish(wake, undefined),
                    {
                      discard: true,
                    },
                  )
                  yield* Effect.forEach(committed.events, (event) => notify(event, true), { discard: true })
                  return committed.events as PublishResult<I>
                }),
              ),
            )
          })
        }

        function replay(
          event: SerializedEvent,
          options?: { readonly publish?: boolean; readonly ownerID?: string; readonly strictOwner?: boolean },
        ) {
          return Effect.gen(function* () {
            const definition = Durable.get(event.type)
            if (!definition?.durable)
              return yield* Effect.die(
                new InvalidDurableEventError({ type: event.type, message: `Unknown durable event type ${event.type}` }),
              )
            yield* durableLocks.withLock(event.aggregateID)(
              Effect.gen(function* () {
                const payload = {
                  id: event.id,
                  created: event.created ?? 0,
                  type: definition.type,
                  data: Schema.decodeUnknownSync(definition.data)(event.data),
                } as Event.Payload
                const committed = yield* commitDurableEvent(definition, payload, {
                  seq: event.seq,
                  aggregateID: event.aggregateID,
                  ownerID: options?.ownerID,
                  strictOwner: options?.strictOwner,
                })
                if (committed && options?.publish) {
                  yield* notify(committed.event, true)
                }
              }),
            )
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
            .pipe(
              Effect.tap(() => Effect.sync(() => sessions.delete(aggregateID as SessionID))),
              Effect.orDie,
            )
        }

        function claim(aggregateID: string, ownerID: string) {
          return db
            .update(EventSequenceTable)
            .set({ owner_id: ownerID })
            .where(eq(EventSequenceTable.aggregate_id, aggregateID))
            .run()
            .pipe(Effect.orDie)
        }

        const local = <A extends Event.Payload>(stream: Stream.Stream<A>) =>
          Stream.unwrap(
            Effect.serviceOption(Location.Service).pipe(
              Effect.map((location) =>
                Option.match(location, {
                  onNone: () => stream,
                  onSome: (location) => {
                    const self = Location.instanceKey(location)
                    return stream.pipe(
                      Stream.filter((event) => {
                        const keys = routes.get(event)
                        if (keys) return keys.includes(self)
                        if (!event.location) return true
                        const key = Location.instanceKey(event.location)
                        routes.set(event, [key])
                        return key === self
                      }),
                    )
                  },
                }),
              ),
            ),
          )

        function subscribe(): Stream.Stream<Event.Payload>
        function subscribe<D extends Event.Definition>(definition: D): Stream.Stream<Event.Payload<D>>
        function subscribe<const D extends readonly [Event.Definition, ...Event.Definition[]]>(
          definitions: D,
        ): Stream.Stream<SubscribePayload<D>>
        function subscribe(input?: Event.Definition | readonly Event.Definition[]): Stream.Stream<Event.Payload> {
          if (input === undefined) return streamLive()
          if (isDefinition(input)) {
            return local(Stream.unwrap(getOrCreate(input).pipe(Effect.map((pubsub) => Stream.fromPubSub(pubsub)))))
          }
          const types = new Set(input.map((definition) => definition.type))
          return streamLive().pipe(Stream.filter((event) => types.has(event.type)))
        }

        const streamLive = (): Stream.Stream<Event.Payload> => local(Stream.fromPubSub(pubsub.live))

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
                    created: event.created,
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
              const readThrough = (through: number): Stream.Stream<Event.Payload> =>
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
                ...(target >= 0 ? { seq: Event.Seq.make(target) } : {}),
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

        const listen = (listener: Subscriber): Effect.Effect<Unsubscribe> =>
          Effect.sync(() => {
            listeners.push(listener)
            return Effect.sync(() => {
              const index = listeners.indexOf(listener)
              if (index >= 0) listeners.splice(index, 1)
            })
          })

        const project = <D extends Event.Definition>(definition: D, projector: Subscriber<D>): Effect.Effect<void> =>
          Effect.sync(() => {
            const key = definition.durable
              ? versionedType(definition.type, definition.durable.version)
              : definition.type
            const list = projectors.get(key) ?? []
            list.push((event) => projector(event as Event.Payload<D>))
            projectors.set(key, list)
          })

        return Service.of({
          publish,
          publishAll,
          subscribe,
          log,
          listen,
          project,
          replay,
          remove,
          claim,
        })
      }),
    ),
  })
}

export const node = configured()
