export * as Persistence from "./schema"

import { Effect, Option, Schema, SchemaGetter, Struct } from "effect"

// Unlike a decoding default, a fallback also replaces invalid persisted values.
export function fallback<S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S, value: () => S["Type"]) {
  const defaulted = Schema.withDecodingDefaultType<S>(Effect.sync(value))(schema)
  return Schema.catchDecoding<typeof defaulted>(() => Effect.sync(() => Option.some(value())))(defaulted)
}

export function optional<S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S) {
  const field = Schema.optional(schema)
  return Schema.catchDecoding<typeof field>(() => Effect.succeed(Option.none()))(field)
}

export function struct<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  return Schema.Struct(fields).mapFields(Struct.map(Schema.mutableKey))
}

export function record<S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S) {
  const entries = Schema.Record(Schema.String, Schema.mutableKey(schema))
  return fallback(entries, () => Schema.decodeUnknownSync(entries)({}))
}

// Recover individual entries rather than discarding a whole history or collection.
export function array<S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S) {
  const decode = Schema.decodeUnknownOption(schema)
  const encode = Schema.encodeSync(schema)
  return fallback(
    Schema.Array(Schema.Unknown).pipe(
      Schema.decodeTo(Schema.mutable(Schema.Array(Schema.toType(schema))), {
        decode: SchemaGetter.transform((items) => items.flatMap((item) => Option.toArray(decode(item)))),
        encode: SchemaGetter.transform((items) => items.map((item) => encode(item))),
      }),
    ),
    () => [],
  )
}
