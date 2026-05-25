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
  return definition as Schema.Schema<Payload<Definition<Type, Schema.Struct<Fields>>>> &
    Definition<Type, Schema.Struct<Fields>>
}

export function definitions() {
  return registry.values().toArray()
}

export interface PublishOptions {
  readonly id?: ID
  readonly metadata?: Record<string, unknown>
}

export interface Interface {
  readonly publish: <D extends Definition>(
    definition: D,
    data: Data<D>,
    options?: PublishOptions,
  ) => Effect.Effect<Payload<D>>
  readonly subscribe: <D extends Definition>(definition: D) => Stream.Stream<Payload<D>>
  readonly all: () => Stream.Stream<Payload>
  readonly project: <D extends Definition>(definition: D, projector: Projector<D>) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Event") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const all = yield* PubSub.unbounded<Payload>()
    const typed = new Map<string, PubSub.PubSub<Payload>>()
    const projectors = new Map<string, AnyProjector[]>()
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

    function runProjectors<D extends Definition>(event: Payload<D>) {
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
                    for (const projector of list) {
                      yield* projector(event as Payload)
                    }
                    const row = yield* db
                      .select({ seq: EventSequenceTable.seq })
                      .from(EventSequenceTable)
                      .where(eq(EventSequenceTable.aggregate_id, aggregateID))
                      .get()
                      .pipe(Effect.orDie)
                    const seq = row?.seq != null ? row.seq + 1 : 0
                    yield* db
                      .insert(EventSequenceTable)
                      .values([{ aggregate_id: aggregateID, seq }])
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

    function publish<D extends Definition>(definition: D, data: Data<D>, options?: PublishOptions) {
      return Effect.gen(function* () {
        const location = Option.getOrUndefined(yield* Effect.serviceOption(Location.Service))
        const event = {
          id: options?.id ?? ID.create(),
          ...(options?.metadata ? { metadata: options.metadata } : {}),
          type: definition.type,
          ...(definition.sync === undefined ? {} : { version: definition.sync.version }),
          ...(location ? { location } : {}),
          data,
        } as Payload<D>
        yield* runProjectors(event)
        const pubsub = typed.get(event.type)
        if (pubsub) yield* PubSub.publish(pubsub, event as Payload)
        yield* PubSub.publish(all, event as Payload)
        return event
      })
    }

    const subscribe = <D extends Definition>(definition: D): Stream.Stream<Payload<D>> =>
      Stream.unwrap(getOrCreate(definition).pipe(Effect.map((pubsub) => Stream.fromPubSub(pubsub)))).pipe(
        Stream.map((event) => event as Payload<D>),
      )

    const streamAll = (): Stream.Stream<Payload> => Stream.fromPubSub(all)

    const project = <D extends Definition>(definition: D, projector: Projector<D>): Effect.Effect<void> =>
      Effect.sync(() => {
        const list = projectors.get(definition.type) ?? []
        list.push((event) => projector(event as Payload<D>))
        projectors.set(definition.type, list)
      })

    return Service.of({ publish, subscribe, all: streamAll, project })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))
