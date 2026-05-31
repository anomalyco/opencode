export * as EventV2 from "./event"

import { Context, Effect, Layer, Option, PubSub, Schema, Stream } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "./database/database"
import { EventSequenceTable, EventTable } from "./event/sql"
import { Location } from "./location"
import { withStatics } from "./schema"
import { Identifier } from "./util/identifier"

export const ID = Schema.String.pipe(
  Schema.brand("Event.ID"),
  withStatics((schema) => ({ create: () => schema.make("evt_" + Identifier.ascending()) })),
)
export type ID = typeof ID.Type

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
  readonly version?: number
  readonly location?: Location.Ref
  readonly metadata?: Record<string, unknown>
}

export type Projector<D extends Definition = Definition> = (event: Payload<D>) => Effect.Effect<void>
type AnyProjector = (event: Payload) => Effect.Effect<void>
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
const syncRegistry = new Map<string, Definition & { readonly sync: NonNullable<Definition["sync"]> }>()

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
      definition as Definition & { readonly sync: NonNullable<Definition["sync"]> },
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
}

export interface Interface {
  readonly publish: <D extends Definition>(
    definition: D,
    data: Data<D>,
    options?: PublishOptions,
  ) => Effect.Effect<Payload<D>>
  readonly subscribe: <D extends Definition>(definition: D) => Stream.Stream<Payload<D>>
  readonly all: () => Stream.Stream<Payload>
  readonly sync: (handler: Sync) => Effect.Effect<Unsubscribe>
  readonly listen: (listener: Listener) => Effect.Effect<Unsubscribe>
  readonly project: <D extends Definition>(definition: D, projector: Projector<D>) => Effect.Effect<void>
  readonly replay: (
    event: SerializedEvent,
    options?: { readonly publish?: boolean; readonly ownerID?: string },
  ) => Effect.Effect<void>
  readonly replayAll: (
    events: SerializedEvent[],
    options?: { readonly publish?: boolean; readonly ownerID?: string },
  ) => Effect.Effect<string | undefined>
  readonly remove: (aggregateID: string) => Effect.Effect<void>
  readonly claim: (aggregateID: string, ownerID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Event") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const all = yield* PubSub.unbounded<Payload>()
    const typed = new Map<string, PubSub.PubSub<Payload>>()
    const projectors = new Map<string, AnyProjector[]>()
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
        yield* Effect.forEach(typed.values(), PubSub.shutdown, { discard: true })
      }),
    )

    function commitSyncEvent(
      event: Payload,
      input?: { readonly seq: number; readonly aggregateID: string; readonly ownerID?: string },
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
            const list = projectors.get(event.type) ?? []
            yield* db
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
                    if (input && input.seq <= latest) return
                    if (input && row?.ownerID && row.ownerID !== input.ownerID) return
                    const seq = input?.seq ?? latest + 1
                    if (input && seq !== latest + 1) {
                      yield* Effect.die(
                        new InvalidSyncEventError({
                          type: event.type,
                          message: `Sequence mismatch for aggregate ${aggregateID}: expected ${latest + 1}, got ${seq}`,
                        }),
                      )
                    }
                    for (const projector of list) {
                      yield* projector(event as Payload)
                    }
                    yield* db
                      .insert(EventSequenceTable)
                      .values([{ aggregate_id: aggregateID, seq, owner_id: input?.ownerID }])
                      .onConflictDoUpdate({
                        target: EventSequenceTable.aggregate_id,
                        set: { seq },
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
                          data: event.data as Record<string, unknown>,
                        },
                      ])
                      .run()
                      .pipe(Effect.orDie)
                  }),
                { behavior: "immediate" },
              )
              .pipe(Effect.orDie)
          }
        }
      })
    }

    function publishEvent<D extends Definition>(event: Payload<D>) {
      return Effect.gen(function* () {
        for (const sync of syncHandlers) {
          yield* sync(event as Payload)
        }
        yield* commitSyncEvent(event as Payload)
        for (const listener of listeners) {
          yield* listener(event as Payload)
        }
        const pubsub = typed.get(event.type)
        if (pubsub) yield* PubSub.publish(pubsub, event as Payload)
        yield* PubSub.publish(all, event as Payload)
        return event
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
        return yield* publishEvent({
          id: options?.id ?? ID.create(),
          ...(options?.metadata ? { metadata: options.metadata } : {}),
          type: definition.type,
          ...(definition.sync === undefined ? {} : { version: definition.sync.version }),
          ...(location ? { location } : {}),
          data,
        } as Payload<D>)
      })
    }

    function replay(event: SerializedEvent, options?: { readonly publish?: boolean; readonly ownerID?: string }) {
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
            data: event.data,
          } as Payload
          yield* commitSyncEvent(payload, { seq: event.seq, aggregateID: event.aggregateID, ownerID: options?.ownerID })
          if (options?.publish) {
            for (const listener of listeners) {
              yield* listener(payload)
            }
            const pubsub = typed.get(payload.type)
            if (pubsub) yield* PubSub.publish(pubsub, payload)
            yield* PubSub.publish(all, payload)
          }
        }
      })
    }

    function replayAll(events: SerializedEvent[], options?: { readonly publish?: boolean; readonly ownerID?: string }) {
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

    const project = <D extends Definition>(definition: D, projector: Projector<D>): Effect.Effect<void> =>
      Effect.sync(() => {
        const list = projectors.get(definition.type) ?? []
        list.push((event) => projector(event as Payload<D>))
        projectors.set(definition.type, list)
      })

    return Service.of({ publish, subscribe, all: streamAll, sync, listen, project, replay, replayAll, remove, claim })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))
