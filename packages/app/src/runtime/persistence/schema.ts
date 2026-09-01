export * as Persistence from "./schema"

import { Effect, Option, Schema, SchemaGetter } from "effect"

export function defaulted<S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S, fallback: () => S["Type"]) {
  const optional = Schema.withDecodingDefaultType(Effect.sync(fallback))(schema)
  return Schema.catchDecoding<typeof optional>(() => Effect.sync(() => Option.some(fallback())))(optional)
}

// Recover individual entries rather than discarding a whole history or collection.
export function array<S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S) {
  const decode = Schema.decodeUnknownOption(schema)
  const encode = Schema.encodeSync(schema)
  return defaulted(
    Schema.Array(Schema.Unknown).pipe(
      Schema.decodeTo(Schema.mutable(Schema.Array(Schema.toType(schema))), {
        decode: SchemaGetter.transform((items) => items.flatMap((item) => Option.toArray(decode(item)))),
        encode: SchemaGetter.transform((items) => items.map((item) => encode(item))),
      }),
    ),
    () => [],
  )
}
