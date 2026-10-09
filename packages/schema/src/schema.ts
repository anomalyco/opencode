import { brand } from "./brand.js"
import { DateTime, Option, Schema, SchemaGetter } from "effect"

export const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const RelativePath = Schema.String.pipe(brand("RelativePath"))
export type RelativePath = typeof RelativePath.Type

export const AbsolutePath = Schema.String.pipe(brand("AbsolutePath"))
export type AbsolutePath = typeof AbsolutePath.Type

export const optional = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(schema).pipe(
    Schema.decodeTo(Schema.optional(Schema.toType(schema)), {
      decode: SchemaGetter.passthrough({ strict: false }),
      encode: SchemaGetter.transformOptional(Option.filter((value) => value !== undefined)),
    }),
  )

// Effect schemas expose `make` through prototype getters, so `Object.assign` cannot override it.
// Defining the properties replaces a constructor as long as the schema's own `make` has not been read.
export const withStatics = <S extends object, M extends Record<string, unknown>>(schema: S, methods: M): S & M =>
  Object.defineProperties(schema, Object.getOwnPropertyDescriptors(methods)) as S & M

export const statics =
  <S extends object, M extends Record<string, unknown>>(methods: (schema: S) => M) =>
  (schema: S): S & M =>
    withStatics(schema, methods(schema))

export const DateTimeUtcFromMillis = Schema.Finite.pipe(
  Schema.decodeTo(Schema.DateTimeUtc, {
    decode: SchemaGetter.transform((value) => DateTime.makeUnsafe(value)),
    encode: SchemaGetter.transform((value) => DateTime.toEpochMillis(value)),
  }),
)
