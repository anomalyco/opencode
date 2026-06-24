export * as Event from "./event"

import { Schema } from "effect"
import { ascending } from "./identifier"
import { Location } from "./location"
import { withStatics } from "./schema"

export const ID = Schema.String.check(Schema.isStartsWith("evt_")).pipe(
  Schema.brand("Event.ID"),
  withStatics((schema) => ({ create: () => schema.make("evt_" + ascending()) })),
)
export type ID = typeof ID.Type

export type Definition<
  Type extends string = string,
  DataSchema extends Schema.Codec<unknown, unknown> = Schema.Codec<unknown, unknown>,
> = Schema.Top & {
  readonly type: Type
  readonly durable?: {
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
  readonly durable?: {
    readonly aggregateID: string
    readonly seq: number
    readonly version: number
  }
  readonly location?: Location.Ref
  readonly metadata?: Record<string, unknown>
}

export function define<
  const Type extends string,
  Fields extends Readonly<Record<PropertyKey, Schema.Codec<unknown, unknown>>>,
>(input: {
  readonly type: Type
  readonly durable?: {
    readonly version: number
    readonly aggregate: string
  }
  readonly schema: Fields
}): Schema.Schema<Payload<Definition<Type, Schema.Struct<Fields>>>> & Definition<Type, Schema.Struct<Fields>> {
  const data = Schema.Struct(input.schema)
  return Object.assign(
    Schema.Struct({
      id: ID,
      metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      type: Schema.Literal(input.type),
      durable: Schema.optional(
        Schema.Struct({ aggregateID: Schema.String, seq: Schema.Number, version: Schema.Number }),
      ),
      location: Schema.optional(Location.Ref),
      data,
    }).annotate({ identifier: input.type }),
    {
      type: input.type,
      ...(input.durable === undefined ? {} : { durable: input.durable }),
      data,
    },
  ) as Schema.Schema<Payload<Definition<Type, Schema.Struct<Fields>>>> & Definition<Type, Schema.Struct<Fields>>
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

export function durable(definitions: ReadonlyArray<Definition>) {
  return readonlyMap(
    definitions.reduce((result, definition) => {
      if (!definition.durable) return result
      const key = versionedType(definition.type, definition.durable.version)
      if (result.has(key)) throw new Error(`Duplicate durable event definition for ${key}`)
      result.set(key, definition)
      return result
    }, new Map<string, Definition>()),
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
