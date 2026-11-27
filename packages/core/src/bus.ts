export * as Bus from "./bus.js"

import { Cause, Clock, Context, Effect, Layer, Option, PubSub, Schema, Stream } from "effect"
import { Event } from "@opencode/schema/event"
import type { EventLog } from "@opencode/schema/event-log"
import { and, asc, eq, gt, lte, sql } from "drizzle-orm"
import { Database } from "./database/database.js"
import { EventSequenceTable, EventTable } from "./event/sql.js"
import { Location } from "./location/service.js"
import { KeyedMutex } from "./effect/keyed-mutex.js"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { isDeepStrictEqual } from "node:util"
import { isSqlError } from "effect/sql/SqlError"
import { Durable } from "@opencode/schema/durable-event-manifest"

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

const requireAggregateID = (type: string, aggregate: string, data: unknown) => {
  const aggregateID = (data as Record<string, unknown>)[aggregate]
  if (typeof aggregateID === "string") return Effect.succeed(aggregateID)
  return Effect.die(new InvalidDurableEventError({ type, message: `Expected string aggregate field ${aggregate}` }))
}

export interface PreparedRoutes {
  readonly routes: ReadonlyMap<Event.Payload, readonly Location.Ref[]>
  readonly commit?: () => void
}

export interface Router {
  readonly prepare: (events: readonly Event.Payload[]) => Effect.Effect<PreparedRoutes>
  readonly remove?: (aggregateID: string) => void
}

export type Upcaster = (type: string, data: unknown) => unknown

export const versionedType = Event.versionedType
export const durable = Event.durable
export const ephemeral = Event.ephemeral

export interface PublishOptions<E = never, C = E> {
  readonly id?: Event.ID
  readonly metadata?: Record<string, unknown>
  readonly location?: Location.Ref
  readonly global?: boolean
  /**
   * Write-time guard executed inside the durable event transaction before projectors run.
   * Not invoked during replay. A failure rolls back the transaction, publishes nothing
   * and surfaces from `publish` or `publishAll`.
   */
  readonly beforeProject?: () => Effect.Effect<void, E>
  /**
   * Local operational projection committed atomically with a new durable event. Not replayed or serialized.
   * A failure rolls back the transaction, publishes nothing and surfaces from `publish`.
   */
  readonly commit?: (seq: number) => Effect.Effect<void, C>
}

export type PublishInput<D extends Event.DurableDefinition = Event.DurableDefinition, E = never, C = E> = readonly [
  definition: D,
  data: Event.Data<D>,
  options?: PublishOptions<E, C>,
]

type AnyPublishInput = PublishInput<Event.DurableDefinition, unknown, unknown>

export type PublishResult<I extends readonly AnyPublishInput[]> = {
  readonly [K in keyof I]: I[K] extends PublishInput<infer D, unknown, unknown> ? Event.Payload<D> : never
}

type HookError<O> =
  | (O extends { readonly beforeProject?: infer B }
      ? B extends () => Effect.Effect<void, infer E>
        ? E
        : never
      : never)
  | (O extends { readonly commit?: infer C }
      ? C extends (seq: number) => Effect.Effect<void, infer E>
        ? E
        : never
      : never)

export type PublishError<I extends readonly AnyPublishInput[]> = I[number][2] extends infer O ? HookError<O> : never

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
   * events. Registered routers can resolve delivery Locations per event without
   * changing the public event.
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
  readonly publish: <D extends Event.Definition, E = never, C = never>(
    definition: D,
    data: Event.Data<D>,
    options?: PublishOptions<E, C>,
  ) => Effect.Effect<Event.Payload<D>, E | C>
  readonly publishAll: <const I extends readonly [AnyPublishInput, ...AnyPublishInput[]]>(
    events: I,
  ) => Effect.Effect<PublishResult<I>, PublishError<I>>
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
  readonly route: (router: Router) => Effect.Effect<void>
  readonly upcast: (upcaster: Upcaster) => Effect.Effect<void>
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
        const pubsub = {
          live: yield* PubSub.unbounded<Event.Payload>(),
          durable: new Map<string, Set<PubSub.PubSub<void>>>(),
          typed: new Map<string, Set<PubSub.PubSub<Event.Payload>>>(),
        }
        const projectors = new Map<string, Subscriber[]>()
        const listeners = new Array<Subscriber>()
        const routers = new Array<Router>()
        const upcasters = new Array<Upcaster>()
        const durableLocks = KeyedMutex.makeUnsafe<string>()
        const database = yield* Database.Service
        const db = database.db
        const logReadPageSize = options?.logReadPageSize ?? 512
        const persist = options?.persist ?? false
        // Keep routing separate from the public event, and retain its snapshot
        // while a slow subscriber drains events queued before a move or deletion.
        const routes = new WeakMap<Event.Payload, readonly Location.Ref[]>()

        const upcastData = (type: string, data: unknown) => upcasters.reduce((current, fn) => fn(type, current), data)

        // Every stored event decodes through here, so payloads written in older shapes are upgraded in one place.
        const decodeStoredData = (definition: Event.DurableDefinition, data: unknown) =>
          Schema.decodeUnknownSync(definition.data)(upcastData(definition.type, data))

        const decodeSerializedEvent = (event: SerializedEvent): Event.Payload => {
          const definition = Durable.get(event.type)
          if (!definition?.durable) {
            throw new InvalidDurableEventError({
              type: event.type,
              message: `Unknown durable event type ${event.type}`,
            })
          }
          return {
            id: event.id,
            created: event.created ?? 0,
            type: definition.type,
            durable: envelope(event.aggregateID, event.seq, definition.durable.version),
            data: decodeStoredData(definition, event.data),
          }
        }

        const prepareRoutes = Effect.fnUntraced(function* (events: readonly Event.Payload[]) {
          if (routers.length === 0) return () => {}
          const prepared = yield* Effect.forEach(routers, (router) => router.prepare(events))
          return () => {
            for (const item of prepared) {
              item.commit?.()
              for (const [event, refs] of item.routes) {
                const existing = routes.get(event)
                routes.set(event, existing ? [...existing, ...refs] : refs)
              }
            }
          }
        })

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            yield* PubSub.shutdown(pubsub.live)
            yield* Effect.forEach(
              pubsub.durable.values(),
              (pubsubs) => Effect.forEach(pubsubs, PubSub.shutdown, { discard: true }),
              { discard: true },
            )
            yield* Effect.forEach(
              pubsub.typed.values(),
              (subscribers) => Effect.forEach(subscribers, PubSub.shutdown, { discard: true }),
              { discard: true },
            )
          }),
        )

        function commitDurableEvent<E = never, C = never>(
          definition: Event.Definition,
          event: Event.Payload,
          input?: {
            readonly seq: number
            readonly aggregateID: string
            readonly ownerID?: string
            readonly strictOwner?: boolean
          },
          hooks?: {
            readonly beforeProject?: () => Effect.Effect<void, E>
            readonly commit?: (seq: number) => Effect.Effect<void, C>
          },
        ) {
          return Effect.gen(function* () {
            const durable = definition.durable
            if (!durable) return yield* Effect.void
            const aggregateID = yield* requireAggregateID(event.type, durable.aggregate, event.data)
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
                        const encode = () =>
                          Schema.encodeUnknownSync(definition.data)(event.data) as Record<string, unknown>
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
                            // Rows written before a payload rename compare in their upgraded shape.
                            isDeepStrictEqual(upcastData(definition.type, stored.data), encode())
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
                        if (hooks?.beforeProject) yield* hooks.beforeProject()
                        const committed = {
                          ...event,
                          durable: { aggregateID, seq, version: durable.version },
                        } as Event.Payload
                        const route = yield* prepareRoutes([committed])
                        for (const projector of list) {
                          yield* projector(committed)
                        }
                        if (hooks?.commit) yield* hooks.commit(seq)
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
                                data: encode(),
                              },
                            ])
                            .run()
                            .pipe(Effect.orDie)
                        return { aggregateID, seq, event: committed, route }
                      }),
                    { behavior: "immediate" },
                  )
                  .pipe(Effect.catchIf(isSqlError, Effect.die))
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
          })
        }

        function publishEvent<D extends Event.Definition, E, C>(
          definition: D,
          event: Event.Payload<D>,
          hooks?: {
            readonly beforeProject?: PublishOptions<E, C>["beforeProject"]
            readonly commit?: PublishOptions<E, C>["commit"]
          },
        ) {
          return Effect.gen(function* () {
            if (!definition.durable && (hooks?.beforeProject || hooks?.commit))
              return yield* Effect.die(
                new InvalidDurableEventError({
                  type: event.type,
                  message: hooks?.commit
                    ? "Local commit hooks require a durable event"
                    : "Write guard hooks require a durable event",
                }),
              )
            if (definition.durable) {
              const aggregateID = (event.data as Record<string, unknown>)[definition.durable.aggregate]
              if (typeof aggregateID !== "string")
                return yield* commitDurableEvent(definition, event as Event.Payload, undefined, hooks).pipe(
                  Effect.as(event),
                )
              return yield* durableLocks.withLock(aggregateID)(
                Effect.gen(function* () {
                  const committed = yield* commitDurableEvent(definition, event as Event.Payload, undefined, hooks)
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
            // Type subscribers resume inline and may publish follow-up events, so live subscribers get this one first.
            yield* PubSub.publish(pubsub.live, event)
            const typed = pubsub.typed.get(event.type)
            if (typed)
              yield* Effect.forEach(typed, (subscriber) => PubSub.publish(subscriber, event), { discard: true })
          })
        }

        const makePayload = (
          definition: Event.Definition,
          data: unknown,
          options: PublishOptions<unknown, unknown> | undefined,
        ) =>
          Effect.gen(function* () {
            const serviceLocation = Option.getOrUndefined(yield* Effect.serviceOption(Location.Service))
            const location = options?.global
              ? undefined
              : (options?.location ??
                (serviceLocation
                  ? { directory: serviceLocation.directory, workspaceID: serviceLocation.workspaceID }
                  : undefined))
            return {
              id: options?.id ?? Event.ID.create(),
              created: yield* Clock.currentTimeMillis,
              ...(options?.metadata ? { metadata: options.metadata } : {}),
              type: definition.type,
              ...(location ? { location } : {}),
              data,
            } as Event.Payload
          })

        function publish<D extends Event.Definition, E = never, C = never>(
          definition: D,
          data: Event.Data<D>,
          options?: PublishOptions<E, C>,
        ) {
          return Effect.gen(function* () {
            const event = (yield* makePayload(definition, data, options)) as Event.Payload<D>
            return yield* publishEvent(definition, event, {
              beforeProject: options?.beforeProject,
              commit: options?.commit,
            })
          })
        }

        function publishAll<const I extends readonly [AnyPublishInput, ...AnyPublishInput[]]>(events: I) {
          return Effect.gen(function* () {
            const payloads = yield* Effect.forEach(events, ([definition, data, options]) =>
              Effect.gen(function* () {
                const aggregateID = yield* requireAggregateID(definition.type, definition.durable.aggregate, data)
                return {
                  definition,
                  aggregateID,
                  // The tuple's own hook error types are what PublishError<I> reads; the loop erases them to unknown.
                  beforeProject: options?.beforeProject as PublishOptions<PublishError<I>>["beforeProject"],
                  commit: options?.commit as PublishOptions<PublishError<I>>["commit"],
                  event: yield* makePayload(definition, data, options),
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
                            if (item.beforeProject) yield* item.beforeProject()
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
                                data: Schema.encodeUnknownSync(item.definition.data)(item.event.data) as Record<
                                  string,
                                  unknown
                                >,
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
                    .pipe(Effect.catchIf(isSqlError, Effect.die))
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
                  data: decodeStoredData(definition, event.data),
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
              Effect.tap(() =>
                Effect.sync(() => {
                  for (const router of routers) router.remove?.(aggregateID)
                }),
              ),
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
                    const matches = (ref: Location.Ref) =>
                      ref.directory === location.directory && ref.workspaceID === location.workspaceID
                    return stream.pipe(
                      Stream.filter((event) => {
                        const refs = routes.get(event)
                        if (refs) return refs.some(matches)
                        return !event.location || matches(event.location)
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
          const types = new Set((isDefinition(input) ? [input] : input).map((definition) => definition.type))
          // One PubSub per subscription, registered under each type, keeps publish order across types.
          return local(
            Stream.unwrap(
              Effect.acquireRelease(
                PubSub.unbounded<Event.Payload>().pipe(
                  Effect.tap((subscriber) =>
                    Effect.sync(() => {
                      for (const type of types)
                        pubsub.typed.set(type, (pubsub.typed.get(type) ?? new Set()).add(subscriber))
                    }),
                  ),
                ),
                (subscriber) =>
                  Effect.sync(() => {
                    for (const type of types) {
                      const subscribers = pubsub.typed.get(type)
                      subscribers?.delete(subscriber)
                      if (subscribers?.size === 0) pubsub.typed.delete(type)
                    }
                  }).pipe(Effect.andThen(PubSub.shutdown(subscriber))),
              ).pipe(Effect.flatMap(PubSub.subscribe), Effect.map(Stream.fromSubscription)),
            ),
          )
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
              const replay: Stream.Stream<LogItem> = readThrough(target).pipe(Stream.concat(Stream.make(marker)))
              if (!wakes) return replay
              const live: Stream.Stream<LogItem> = Stream.fromSubscription(wakes).pipe(
                Stream.mapEffect(() => latestSequence(db, input.aggregateID)),
                Stream.filter((target) => target > sequence),
                Stream.flatMap((target) => readThrough(target)),
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

        const route = (router: Router): Effect.Effect<void> =>
          Effect.sync(() => {
            routers.push(router)
          })

        const upcast = (upcaster: Upcaster): Effect.Effect<void> =>
          Effect.sync(() => {
            upcasters.push(upcaster)
          })

        return Service.of({
          publish,
          publishAll,
          subscribe,
          log,
          listen,
          project,
          route,
          upcast,
          replay,
          remove,
          claim,
        })
      }),
    ),
  })
}

export const node = configured()
