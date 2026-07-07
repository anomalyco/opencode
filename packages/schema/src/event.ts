export * as Event from "./event.js"

import { Schema, SchemaTransformation } from "effect"
import { optional } from "./schema.js"
import { ascending } from "./identifier.js"
import { Location } from "./location.js"
import { DateTimeUtcFromMillis, statics } from "./schema.js"

export const ID = Schema.String.check(Schema.isStartsWith("evt_")).pipe(
  Schema.brand("Event.ID"),
  statics((schema) => ({ create: () => schema.make("evt_" + ascending()) })),
)
export type ID = typeof ID.Type

/**
 * Position in one aggregate's durable log. Values originate from the durable
 * event envelope and synced markers;
 * `after` cursors accept only values that came from those sources.
 */
export const Seq = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand("Event.Seq"))
export type Seq = typeof Seq.Type

/** Durable schema version of one event type, from the event definition that committed it. */
export const Version = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(Schema.brand("Event.Version"))
export type Version = typeof Version.Type

const DurableEnvelope = Schema.Struct({ aggregateID: Schema.String, seq: Seq, version: Version })
export type DurableEnvelope = typeof DurableEnvelope.Type

export type DurableDefinition<
  Type extends string = string,
  DataSchema extends Schema.Codec<unknown, unknown> = Schema.Codec<unknown, unknown>,
> = Schema.Top & {
  readonly type: Type
  readonly durability: "durable"
  readonly durable: {
    readonly version: number
    readonly aggregate: string
  }
  readonly data: DataSchema
}

export type EphemeralDefinition<
  Type extends string = string,
  DataSchema extends Schema.Codec<unknown, unknown> = Schema.Codec<unknown, unknown>,
> = Schema.Top & {
  readonly type: Type
  readonly durability: "ephemeral"
  readonly durable?: never
  readonly data: DataSchema
}

export type Definition<
  Type extends string = string,
  DataSchema extends Schema.Codec<unknown, unknown> = Schema.Codec<unknown, unknown>,
> = DurableDefinition<Type, DataSchema> | EphemeralDefinition<Type, DataSchema>

export type Data<D extends Definition> = Schema.Schema.Type<D["data"]>

type PayloadBase<D extends Definition> = {
  readonly id: ID
  readonly type: D["type"]
  readonly created: typeof DateTimeUtcFromMillis.Type
  readonly data: Data<D>
  readonly location?: Location.Ref
  readonly metadata?: Record<string, unknown>
}

export type Payload<D extends Definition = Definition> = D extends DurableDefinition
  ? PayloadBase<D> & { readonly durable: DurableEnvelope }
  : PayloadBase<D> & { readonly durable?: never }

type Input<Type extends string, Fields extends Readonly<Record<PropertyKey, Schema.Codec<unknown, unknown>>>> = {
  readonly type: Type
  readonly identifier?: string
  readonly durable?: {
    readonly version: number
    readonly aggregate: string
  }
  readonly schema: Fields
}

export function durable<
  const Type extends string,
  const Fields extends Readonly<Record<PropertyKey, Schema.Codec<unknown, unknown>>>,
>(input: Input<Type, Fields> & { readonly durable: NonNullable<Input<Type, Fields>["durable"]> }) {
  const data = Schema.Struct(input.schema)
  const durable = Schema.Struct({
    aggregateID: DurableEnvelope.fields.aggregateID,
    seq: DurableEnvelope.fields.seq,
    version: Schema.Literal(input.durable.version).pipe(
      Schema.decodeTo(
        Schema.toType(Version),
        SchemaTransformation.transform({
          decode: () => Version.make(input.durable.version),
          encode: () => input.durable.version,
        }),
      ),
    ),
  })
  return Schema.Struct({
    id: ID,
    created: DateTimeUtcFromMillis,
    metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
    type: Schema.Literal(input.type),
    durable,
    location: optional(Location.Ref),
    data,
  })
    .annotate({ identifier: input.identifier ?? input.type })
    .pipe(
      statics(() => ({
        type: input.type,
        durability: "durable" as const,
        durable: input.durable,
        data,
      })),
    ) satisfies DurableDefinition<Type, typeof data>
}

export function ephemeral<
  const Type extends string,
  const Fields extends Readonly<Record<PropertyKey, Schema.Codec<unknown, unknown>>>,
>(input: Omit<Input<Type, Fields>, "durable">) {
  const data = Schema.Struct(input.schema)
  return Schema.Struct({
    id: ID,
    created: DateTimeUtcFromMillis,
    metadata: optional(Schema.Record(Schema.String, Schema.Unknown)),
    type: Schema.Literal(input.type),
    location: optional(Location.Ref),
    data,
  })
    .annotate({ identifier: input.identifier ?? input.type })
    .pipe(
      statics(() => ({
        type: input.type,
        durability: "ephemeral" as const,
        durable: undefined,
        data,
      })),
    ) satisfies EphemeralDefinition<Type, typeof data>
}

export function inventory<const Definitions extends ReadonlyArray<Definition>>(...definitions: Definitions) {
  return Object.freeze(definitions)
}

export function latest(definitions: ReadonlyArray<Definition>) {
  return readonlyMap(
    definitions.reduce((result, definition) => {
      const existing = result.get(definition.type)
      if (!existing) {
        result.set(definition.type, definition)
        return result
      }
      if (definition.durable && existing.durable && definition.durable.version !== existing.durable.version) {
        if (definition.durable.version > existing.durable.version) result.set(definition.type, definition)
        return result
      }
      if (definition !== existing) throw new Error(`Duplicate latest event definition for ${definition.type}`)
      return result
    }, new Map<string, Definition>()),
  )
}

export function versionedType(type: string, version: number) {
  return `${type}.${version}`
}

export function durableMap<const Definitions extends ReadonlyArray<Definition>>(definitions: Definitions) {
  return readonlyMap(
    definitions.reduce((result, definition) => {
      if (definition.durability !== "durable") return result
      const key = versionedType(definition.type, definition.durable.version)
      if (result.has(key)) throw new Error(`Duplicate durable event definition for ${key}`)
      result.set(key, definition)
      return result
    }, new Map<string, DurableDefinition>()),
  )
}

function readonlyMap<Key, Value>(map: Map<Key, Value>): ReadonlyMap<Key, Value> {
  const result: ReadonlyMap<Key, Value> = Object.freeze({
    get size() {
      return map.size
    },
    entries: () => map.entries(),
    forEach: (callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void, thisArg?: unknown) =>
      map.forEach((value, key) => callback.call(thisArg, value, key, result)),
    get: (key: Key) => map.get(key),
    has: (key: Key) => map.has(key),
    keys: () => map.keys(),
    values: () => map.values(),
    [Symbol.iterator]: () => map[Symbol.iterator](),
  })
  return result
}
