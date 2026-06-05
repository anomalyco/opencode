export * as EventV2 from "./event"

import { Cause, Context, Effect, Layer, Option, PubSub, Schema, Stream } from "effect"
import { and, asc, eq, gt } from "drizzle-orm"
import { Database } from "./database/database"
import { EventSequenceTable, EventTable } from "./event/sql"
import { Location } from "./location"
import { externalID, type ExternalID, NonNegativeInt, withStatics } from "./schema"
import { Identifier } from "./util/identifier"
import { isDeepStrictEqual } from "node:util"

export const ID = Schema.String.check(Schema.isStartsWith("evt_")).pipe(
  Schema.brand("Event.ID"),
  withStatics((schema) => ({
    create: () => schema.make("evt_" + Identifier.ascending()),
    fromExternal: (input: ExternalID) => schema.make(externalID("evt", input)),
  })),
)
export type ID = typeof ID.Type

/**
 * Durable aggregate continuation position for embedded replay streams.
 * TODO: Decide whether a future HTTP / SDK surface should expose an opaque cursor instead.
 */
export const Cursor = NonNegativeInt.pipe(Schema.brand("EventV2.Cursor"))
export type Cursor = typeof Cursor.Type

export type Definition<Type extends string = string, DataSchema extends Schema.Top = Schema.Top> = {
  readonly type: Type
  readonly sync?: {
    readonly version: number
    readonly aggregate: string
  }
  readonly data: DataSchema
}

export type Data<D extends Definition> = Schema.Schema.Type<D["data"]>

export type Payload<D extends Definition = Definition> = {
  readonly id: ID
  readonly type: D["type"]
  readonly data: Data<D>
  /** Durable aggregate order, populated while synchronized events are projected. */
  readonly seq?: number
  readonly version?: number
  readonly location?: Location.Ref
  readonly metadata?: Record<string, unknown>
  /** Internal replay marker for projectors that own non-replicated operational state. */
  readonly replay?: boolean
}

export type Projector<D extends Definition = Definition> = (event: Payload<D>) => Effect.Effect<void>
type AnyProjector = (event: Payload) => Effect.Effect<void>
export type CommitGuard = (event: Payload) => Effect.Effect<void>
export type Listener = (event: Payload) => Effect.Effect<void>
export type Sync = (event: Payload) => Effect.Effect<void>
export type Unsubscribe = Effect.Effect<void>

export type SerializedEvent = {
  readonly id: ID
  readonly type: string
  readonly seq: number
  readonly aggregateID: string
  readonly data: Record<string, unknown>
}

export type CursorEvent<E extends Payload = Payload> = {
  readonly cursor: Cursor
  readonly event: E
}

export class InvalidSyncEventError extends Schema.TaggedErrorClass<InvalidSyncEventError>()(
  "EventV2.InvalidSyncEvent",
  {
    type: Schema.String,
    message: Schema.String,
  },
) {}

export function versionedType(type: string, version: number) {
  return `${type}.${version}`
}

export const registry = new Map<string, Definition>()
type SyncDefinition = Definition & {
  readonly sync: NonNullable<Definition["sync"]>
  readonly encode: (data: unknown) => unknown
  readonly decode: (data: unknown) => unknown
}
const syncRegistry = new Map<string, SyncDefinition>()

// Synchronized events cross a JSON boundary, so their data schemas must encode and decode without services.
const syncCodec = (definition: Definition) => definition.data as Schema.Codec<unknown, unknown, never, never>

export function define<const Type extends string, Fields extends Schema.Struct.Fields>(input: {
  readonly type: Type
  readonly sync?: {
    readonly version: number
    readonly aggregate: string
  }
  readonly schema: Fields
}): Schema.Schema<Payload<Definition<Type, Schema.Struct<Fields>>>> & Definition<Type, Schema.Struct<Fields>> {
  const Data = Schema.Struct(input.schema)
  const Payload = Schema.Struct({
    id: ID,
    metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    type: Schema.Literal(input.type),
    version: Schema.optional(Schema.Number),
    location: Schema.optional(Location.Ref),
    data: Data,
  }).annotate({ identifier: input.type })

  const definition = Object.assign(Payload, {
    type: input.type,
    ...(input.sync === undefined ? {} : { sync: input.sync }),
    data: Data,
  })
  const existing = registry.get(input.type)
  if (input.sync === undefined || existing?.sync === undefined || input.sync.version >= existing.sync.version) {
    registry.set(input.type, definition)
  }
  if (input.sync)
    syncRegistry.set(
      versionedType(input.type, input.sync.version),
      Object.assign(definition, {
        encode: Schema.encodeUnknownSync(syncCodec(definition)),
        decode: Schema.decodeUnknownSync(syncCodec(definition)),
      }) as SyncDefinition,
    )
  return definition as Schema.Schema<Payload<Definition<Type, Schema.Struct<Fields>>>> &
    Definition<Type, Schema.Struct<Fields>>
}

export function definitions() {
  return registry.values().toArray()
}

export interface PublishOptions {
  readonly id?: ID
  readonly metadata?: Record<string, unknown>
  readonly location?: Location.Ref
  /** Local operational projection committed atomically with a new synchronized event. Not replayed or serialized. */
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
  readonly aggregateEvents: (input: {
    readonly aggregateID: string
    readonly after?: Cursor
  }) => Stream.Stream<CursorEvent>
  readonly sync: (handler: Sync) => Effect.Effect<Unsubscribe>
  readonly listen: (listener: Listener) => Effect.Effect<Unsubscribe>
  readonly beforeCommit: (guard: CommitGuard) => Effect.Effect<void>
  readonly project: <D extends Definition>(definition: D, projector: Projector<D>) => Effect.Effect<void>
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

export interface LayerOptions {
  readonly beforeAggregateRead?: (aggregateID: string) => Effect.Effect<void>
}

export const layerWith = (options?: LayerOptions) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const all = yield* PubSub.unbounded<Payload>()
      const synchronized = new Map<string, Set<PubSub.PubSub<void>>>()
      const typed = new Map<string, PubSub.PubSub<Payload>>()
      const projectors = new Map<string, AnyProjector[]>()
      const commitGuards = new Array<CommitGuard>()
      const listeners = new Array<Listener>()
      const syncHandlers = new Array<Sync>()
      const { db } = yield* Database.Service

      const getOrCreate = (definition: Definition) =>
        Effect.gen(function* () {
          const existing = typed.get(definition.type)
          if (existing) return existing
          const pubsub = yield* PubSub.unbounded<Payload>()
          typed.set(definition.type, pubsub)
          return pubsub
        })

      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* PubSub.shutdown(all)
          yield* Effect.forEach(
            synchronized.values(),
            (pubsubs) => Effect.forEach(pubsubs, PubSub.shutdown, { discard: true }),
            { discard: true },
          )
          yield* Effect.forEach(typed.values(), PubSub.shutdown, { discard: true })
        }),
      )

      function commitSyncEvent(
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
          const definition = registry.get(event.type)
          const sync = definition?.sync
          if (sync) {
            if (event.version !== sync.version) {
              yield* Effect.die(
                new InvalidSyncEventError({
                  type: event.type,
                  message: `Expected event version ${sync.version}, got ${event.version}`,
                }),
              )
            }
            const aggregateID = (event.data as Record<string, unknown>)[sync.aggregate]
            if (typeof aggregateID !== "string") {
              yield* Effect.die(
                new InvalidSyncEventError({
                  type: event.type,
                  message: `Expected string aggregate field ${sync.aggregate}`,
                }),
              )
            } else {
              if (input && input.aggregateID !== aggregateID) {
                yield* Effect.die(
                  new InvalidSyncEventError({
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
                          const encoded = syncRegistry
                            .get(versionedType(definition.type, sync.version))!
                            .encode(event.data) as Record<string, unknown>
                          if (input?.strictOwner && row?.ownerID && row.ownerID !== input.ownerID) {
                            yield* Effect.die(
                              new InvalidSyncEventError({
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
                              stored.type === versionedType(definition.type, sync.version) &&
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
                              new InvalidSyncEventError({
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
                              new InvalidSyncEventError({
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
                              new InvalidSyncEventError({
                                type: event.type,
                                message: `Event ${event.id} already exists at aggregate ${stored.aggregateID} sequence ${stored.seq}`,
                              }),
                            )
                          for (const guard of commitGuards) {
                            yield* guard(event)
                          }
                          for (const projector of list) {
                            yield* projector({ ...event, seq } as Payload)
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
                                type: versionedType(definition.type, sync.version),
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
                      synchronized.get(committed.aggregateID) ?? [],
                      (pubsub) => PubSub.publish(pubsub, undefined),
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

      function publishEvent<D extends Definition>(event: Payload<D>, commit?: PublishOptions["commit"]) {
        return Effect.gen(function* () {
          const durable = registry.get(event.type)?.sync !== undefined
          if (!durable && commit)
            return yield* Effect.die(
              new InvalidSyncEventError({
                type: event.type,
                message: "Local commit hooks require a synchronized event",
              }),
            )
          if (durable) {
            const committed = yield* commitSyncEvent(event as Payload, undefined, commit)
            if (committed) {
              event = { ...event, seq: committed.seq }
              yield* Effect.forEach(syncHandlers, (sync) => observe(event as Payload, "sync", sync), { discard: true })
              yield* notify(event as Payload, true)
              return event
            }
          }
          yield* notify(event as Payload, false)
          return event
        })
      }

      const observe = (event: Payload, kind: "sync" | "listener", observer: (event: Payload) => Effect.Effect<void>) =>
        Effect.suspend(() => observer(event)).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterrupts(cause),
            (cause) =>
              Effect.logError("Event observer failed").pipe(
                Effect.annotateLogs({ eventID: event.id, eventType: event.type, kind, cause }),
              ),
          ),
        )

      function notify(event: Payload, isolateListeners: boolean) {
        return Effect.gen(function* () {
          yield* Effect.forEach(
            listeners,
            (listener) => (isolateListeners ? observe(event, "listener", listener) : listener(event)),
            { discard: true },
          )
          const pubsub = typed.get(event.type)
          if (pubsub) yield* PubSub.publish(pubsub, event)
          yield* PubSub.publish(all, event)
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
            {
              id: options?.id ?? ID.create(),
              ...(options?.metadata ? { metadata: options.metadata } : {}),
              type: definition.type,
              ...(definition.sync === undefined ? {} : { version: definition.sync.version }),
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
          const definition = syncRegistry.get(event.type)
          if (!definition) {
            yield* Effect.die(
              new InvalidSyncEventError({ type: event.type, message: `Unknown sync event type ${event.type}` }),
            )
          } else {
            const payload = {
              id: event.id,
              type: definition.type,
              version: definition.sync.version,
              data: definition.decode(event.data),
              replay: true,
            } as Payload
            const committed = yield* commitSyncEvent(payload, {
              seq: event.seq,
              aggregateID: event.aggregateID,
              ownerID: options?.ownerID,
              strictOwner: options?.strictOwner,
            })
            if (committed && options?.publish) {
              yield* notify({ ...payload, seq: committed.seq }, true)
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
              new InvalidSyncEventError({
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
                new InvalidSyncEventError({
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

      const streamAll = (): Stream.Stream<Payload> => Stream.fromPubSub(all)

      const decodeSerializedEvent = (event: SerializedEvent): CursorEvent => {
        const definition = syncRegistry.get(event.type)
        if (!definition) {
          throw new InvalidSyncEventError({ type: event.type, message: `Unknown sync event type ${event.type}` })
        }
        return {
          cursor: Cursor.make(event.seq),
          event: {
            id: event.id,
            type: definition.type,
            version: definition.sync.version,
            seq: event.seq,
            data: definition.decode(event.data),
          },
        }
      }

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

      const subscribeSynchronized = (aggregateID: string) =>
        Effect.gen(function* () {
          const pubsub = yield* PubSub.sliding<void>(1)
          const subscription = yield* PubSub.subscribe(pubsub)
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              const pubsubs = synchronized.get(aggregateID) ?? new Set()
              pubsubs.add(pubsub)
              synchronized.set(aggregateID, pubsubs)
            }),
            () =>
              Effect.sync(() => {
                const pubsubs = synchronized.get(aggregateID)
                pubsubs?.delete(pubsub)
                if (pubsubs?.size === 0) synchronized.delete(aggregateID)
              }).pipe(Effect.andThen(PubSub.shutdown(pubsub))),
          )
          return subscription
        })

      const streamEvents = (input: {
        readonly aggregateID: string
        readonly after?: Cursor
      }): Stream.Stream<CursorEvent> =>
        Stream.unwrap(
          Effect.gen(function* () {
            const synchronized = yield* subscribeSynchronized(input.aggregateID)
            let cursor = input.after ?? -1
            const read = Effect.suspend(() => readAfter(input.aggregateID, cursor)).pipe(
              Effect.tap((events) =>
                Effect.sync(() => {
                  cursor = events.at(-1)?.cursor ?? cursor
                }),
              ),
            )
            const historical = yield* read
            const live = Stream.fromSubscription(synchronized).pipe(
              Stream.mapEffect(() => read),
              Stream.flattenIterable,
            )
            return Stream.concat(Stream.fromIterable(historical), live)
          }),
        )

      const listen = (listener: Listener): Effect.Effect<Unsubscribe> =>
        Effect.sync(() => {
          listeners.push(listener)
          return Effect.sync(() => {
            const index = listeners.indexOf(listener)
            if (index >= 0) listeners.splice(index, 1)
          })
        })

      const sync = (handler: Sync): Effect.Effect<Unsubscribe> =>
        Effect.sync(() => {
          syncHandlers.push(handler)
          return Effect.sync(() => {
            const index = syncHandlers.indexOf(handler)
            if (index >= 0) syncHandlers.splice(index, 1)
          })
        })

      const beforeCommit = (guard: CommitGuard): Effect.Effect<void> =>
        Effect.sync(() => {
          commitGuards.push(guard)
        })

      const project = <D extends Definition>(definition: D, projector: Projector<D>): Effect.Effect<void> =>
        Effect.sync(() => {
          const list = projectors.get(definition.type) ?? []
          list.push((event) => projector(event as Payload<D>))
          projectors.set(definition.type, list)
        })

      return Service.of({
        publish,
        subscribe,
        all: streamAll,
        aggregateEvents: streamEvents,
        sync,
        listen,
        beforeCommit,
        project,
        replay,
        replayAll,
        remove,
        claim,
      })
    }),
  )

export const layer = layerWith()

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))
