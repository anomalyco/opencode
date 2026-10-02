import { DateTime, Option, Schema, SchemaGetter } from "effect"

export const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const RelativePath = Schema.String.pipe(
  Schema.brand("RelativePath"),
  Schema.annotate({ identifier: "RelativePath" }),
)
export type RelativePath = typeof RelativePath.Type

export const AbsolutePath = Schema.String.pipe(
  Schema.brand("AbsolutePath"),
  Schema.annotate({ identifier: "AbsolutePath" }),
)
export type AbsolutePath = typeof AbsolutePath.Type

export const optional = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(schema).pipe(
    Schema.decodeTo(Schema.optional(Schema.toType(schema)), {
      decode: SchemaGetter.passthrough({ strict: false }),
      encode: SchemaGetter.transformOptional(Option.filter((value) => value !== undefined)),
    }),
  )

// Effect 4 caches `make` and other schema methods as non-configurable own properties on first access.
// Keep the original schema as a prototype so domain constructors can shadow those methods safely.
export const extendSchema = <S extends object, M extends Record<string, unknown>>(schema: S, methods: M): S & M =>
  Object.defineProperties(Object.create(schema) as S, Object.getOwnPropertyDescriptors(methods)) as S & M

export const statics =
  <S extends object, M extends Record<string, unknown>>(methods: (schema: S) => M) =>
  (schema: S): S & M =>
    extendSchema(schema, methods(schema))

export const DateTimeUtcFromMillis = Schema.Finite.pipe(
  Schema.decodeTo(Schema.DateTimeUtc, {
    decode: SchemaGetter.transform((value) => DateTime.makeUnsafe(value)),
    encode: SchemaGetter.transform((value) => DateTime.toEpochMillis(value)),
  }),
)
