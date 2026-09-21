export * as Codec from "./codec"

// Plain codecs for persisted state. They replace Effect Schema in the renderer's initial module
// graph, where Effect's own module initialisation was the single largest startup cost that was not
// rendering. Semantics mirror the Persistence helpers: decoding never throws, `INVALID` marks a
// value that cannot be recovered, and the lenient combinators recover what they can.

export const INVALID: unique symbol = Symbol.for("opencode/persistence/codec/invalid")
export type Invalid = typeof INVALID

const tag: unique symbol = Symbol.for("opencode/persistence/codec")

export interface Of<T, E = unknown> {
  readonly [tag]: true
  /** Phantom: `typeof codec.Type` is the decoded type, as with Effect schemas. */
  readonly Type: T
  readonly Encoded: E
  readonly optional?: boolean
  decode(input: unknown): T | Invalid
  encode(value: T): E
}

export type Any = Of<any, any>
export type Type<C extends Any> = C["Type"]

export function isCodec(value: unknown): value is Any {
  return typeof value === "object" && value !== null && tag in value
}

export function make<T, E = unknown>(decode: (input: unknown) => T | Invalid, encode: (value: T) => E): Of<T, E> {
  return { [tag]: true, decode, encode } as Of<T, E>
}

export function is<T>(codec: Of<T>, input: unknown): input is T {
  return codec.decode(input) !== INVALID
}

export function decodeOption<T>(codec: Of<T>, input: unknown): T | undefined {
  const value = codec.decode(input)
  return value === INVALID ? undefined : value
}

export function decodeOrThrow<T>(codec: Of<T>, input: unknown): T {
  const value = codec.decode(input)
  if (value === INVALID) throw new Error("Value does not match its codec")
  return value
}

/** Encodes and checks the result decodes, so an invalid in-memory value fails loudly instead of persisting. */
export function encodeOrThrow<T, E>(codec: Of<T, E>, value: T): E {
  const encoded = codec.encode(value)
  if (codec.decode(encoded) === INVALID) throw new Error("Value does not match its codec")
  return encoded
}

const identity = <T>(value: T) => value

export const string: Of<string, string> = make((v) => (typeof v === "string" ? v : INVALID), identity)
export const boolean: Of<boolean, boolean> = make((v) => (typeof v === "boolean" ? v : INVALID), identity)
export const unknown: Of<unknown, unknown> = make((v) => v, identity)
/** Finite numbers only: NaN and infinities are not JSON and never valid state. */
export const number: Of<number, number> = make((v) => (typeof v === "number" && Number.isFinite(v) ? v : INVALID), identity)
export const int: Of<number, number> = make((v) => (typeof v === "number" && Number.isInteger(v) ? v : INVALID), identity)
export const nonNegativeInt: Of<number, number> = make(
  (v) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : INVALID),
  identity,
)

export function literal<const L extends string | number | boolean | null>(value: L): Of<L, L> {
  return make((v) => (v === value ? value : INVALID), identity)
}

export function literals<const L extends ReadonlyArray<string | number | boolean | null>>(values: L): Of<L[number], L[number]> {
  const set = new Set<unknown>(values)
  return make((v) => (set.has(v) ? (v as L[number]) : INVALID), identity)
}

/** A string carrying a nominal brand, with the constructor Effect's `Schema.brand` gave callers. */
export function brand<B extends string>(): Of<string & { readonly [K in B]: B }, string> & {
  make(value: string): string & { readonly [K in B]: B }
} {
  return Object.assign(make<string & { readonly [K in B]: B }, string>((v) => (typeof v === "string" ? (v as never) : INVALID), identity), {
    make: (value: string) => value as never,
  })
}

export function nullOr<T, E>(codec: Of<T, E>): Of<T | null, E | null> {
  return make((v) => (v === null ? null : codec.decode(v)), (v) => (v === null ? null : codec.encode(v)))
}

export function undefinedOr<T, E>(codec: Of<T, E>): Of<T | undefined, E | undefined> {
  return make((v) => (v === undefined ? undefined : codec.decode(v)), (v) => (v === undefined ? undefined : codec.encode(v)))
}

/** A struct field that may be absent. Present but invalid values make the struct invalid. */
export function optional<T, E>(codec: Of<T, E>): Of<T | undefined, E | undefined> & { readonly optional: true } {
  return { ...undefinedOr(codec), optional: true } as never
}

/** A struct field that may be absent, and whose invalid values are dropped rather than rejected. */
export function lenientOptional<T, E>(codec: Of<T, E>): Of<T | undefined, E | undefined> & { readonly optional: true } {
  return {
    ...make<T | undefined, E | undefined>(
      (v) => {
        if (v === undefined) return undefined
        const value = codec.decode(v)
        return value === INVALID ? undefined : value
      },
      (v) => (v === undefined ? undefined : codec.encode(v)),
    ),
    optional: true,
  } as never
}

type Fields = Record<string, Any>
type OptionalKeys<F extends Fields> = { [K in keyof F]: F[K] extends { optional: true } ? K : never }[keyof F]
type RequiredKeys<F extends Fields> = Exclude<keyof F, OptionalKeys<F>>
type Simplify<T> = { [K in keyof T]: T[K] } & {}
export type StructType<F extends Fields> = Simplify<
  { [K in RequiredKeys<F>]: F[K]["Type"] } & { [K in OptionalKeys<F>]?: F[K]["Type"] }
>
export type StructEncoded<F extends Fields> = Simplify<
  { [K in RequiredKeys<F>]: F[K]["Encoded"] } & { [K in OptionalKeys<F>]?: F[K]["Encoded"] }
>

export interface Struct<F extends Fields> extends Of<StructType<F>, StructEncoded<F>> {
  readonly fields: F
}

// `preserve` keeps keys the struct does not declare, for migration shapes that only describe the
// fields they rewrite (Effect's `onExcessProperty: "preserve"`); the current schema then decides.
export function struct<const F extends Fields>(fields: F, options?: { preserve?: boolean }): Struct<F> {
  const entries = Object.entries(fields)
  return {
    ...make<StructType<F>, StructEncoded<F>>(
      (input) => {
        if (typeof input !== "object" || input === null || Array.isArray(input)) return INVALID
        const record = input as Record<string, unknown>
        const out: Record<string, unknown> = options?.preserve ? { ...record } : {}
        for (const [key, codec] of entries) {
          const present = Object.hasOwn(record, key)
          if (!present && codec.optional) continue
          const value = codec.decode(record[key])
          if (value === INVALID) return INVALID
          if (value !== undefined || present) out[key] = value
          else delete out[key]
        }
        return out as StructType<F>
      },
      (value) => {
        const out: Record<string, unknown> = {}
        for (const [key, codec] of entries) {
          const field = (value as Record<string, unknown>)[key]
          if (field === undefined && !Object.hasOwn(value as object, key)) continue
          out[key] = codec.encode(field)
        }
        return out as StructEncoded<F>
      },
    ),
    fields,
  }
}

export function array<T, E>(codec: Of<T, E>): Of<T[], E[]> {
  return make(
    (input) => {
      if (!Array.isArray(input)) return INVALID
      const out: T[] = []
      for (const item of input) {
        const value = codec.decode(item)
        if (value === INVALID) return INVALID
        out.push(value)
      }
      return out
    },
    (value) => value.map((item) => codec.encode(item)),
  )
}

/** Keeps the items that decode and drops the rest, like `Persistence.array`. */
export function lenientArray<T, E>(codec: Of<T, E>): Of<T[], E[]> {
  return make(
    (input) => {
      if (!Array.isArray(input)) return []
      return input.flatMap((item) => {
        const value = codec.decode(item)
        return value === INVALID ? [] : [value]
      })
    },
    (value) => value.map((item) => codec.encode(item)),
  )
}

export function record<T, E>(codec: Of<T, E>): Of<Record<string, T>, Record<string, E>> {
  return make(
    (input) => {
      if (typeof input !== "object" || input === null || Array.isArray(input)) return INVALID
      const out: Record<string, T> = {}
      for (const [key, item] of Object.entries(input)) {
        const value = codec.decode(item)
        if (value === INVALID) return INVALID
        out[key] = value
      }
      return out
    },
    (value) => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, codec.encode(item)])),
  )
}

/** A record that drops entries whose values are invalid, the replacement for `catchDecoding` to none. */
export function sparseRecord<T, E>(codec: Of<T, E>): Of<Record<string, T>, Record<string, E>> {
  return make(
    (input) => {
      if (typeof input !== "object" || input === null || Array.isArray(input)) return INVALID
      const out: Record<string, T> = {}
      for (const [key, item] of Object.entries(input)) {
        const value = codec.decode(item)
        if (value !== INVALID) out[key] = value
      }
      return out
    },
    (value) => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, codec.encode(item)])),
  )
}

/** An invalid record becomes empty rather than failing the whole store, like `Persistence.record`. */
export function lenientRecord<T, E>(codec: Of<T, E>): Of<Record<string, T>, Record<string, E>> {
  const strict = record(codec)
  return make(
    (input) => {
      const value = strict.decode(input)
      return value === INVALID ? {} : value
    },
    strict.encode,
  )
}

export function union<const C extends ReadonlyArray<Any>>(codecs: C): Of<C[number]["Type"], C[number]["Encoded"]> {
  return make(
    (input) => {
      for (const codec of codecs) {
        const value = codec.decode(input)
        if (value !== INVALID) return value
      }
      return INVALID
    },
    (value) => {
      // Encode with the first member that accepts the value's shape; members are disjoint in practice.
      for (const codec of codecs) if (codec.decode(value) !== INVALID) return codec.encode(value)
      return value as C[number]["Encoded"]
    },
  )
}

/** Maps a decoded value into another shape, the replacement for `decodeTo` + `SchemaGetter.transform`. */
export function transform<T, E, T2>(
  codec: Of<T, E>,
  options: { decode: (value: T) => T2; encode: (value: T2) => T },
): Of<T2, E> {
  return make(
    (input) => {
      const value = codec.decode(input)
      return value === INVALID ? INVALID : options.decode(value)
    },
    (value) => codec.encode(options.encode(value)),
  )
}

/** Decodes with `source`, maps, then validates with `target`: Effect's `decodeTo` with a transform. */
export function decodeTo<T, E, T2, E2>(
  source: Of<T, E>,
  target: Of<T2, E2>,
  options: { decode: (value: T) => E2; encode: (value: T2) => T },
): Of<T2, E> {
  return make(
    (input) => {
      const value = source.decode(input)
      return value === INVALID ? INVALID : target.decode(options.decode(value))
    },
    (value) => source.encode(options.encode(value)),
  )
}

/** Invalid and missing values become `value()`, like `Persistence.fallback`. */
export function fallback<T, E>(codec: Of<T, E>, value: () => NoInfer<T>): Of<T, E> {
  return make(
    (input) => {
      if (input === undefined) return value()
      const decoded = codec.decode(input)
      return decoded === INVALID ? value() : decoded
    },
    codec.encode,
  )
}

export function fromJsonString<T, E>(codec: Of<T, E>): Of<T, string> {
  return make(
    (input) => {
      if (typeof input !== "string") return INVALID
      try {
        return codec.decode(JSON.parse(input))
      } catch {
        return INVALID
      }
    },
    (value) => JSON.stringify(codec.encode(value)),
  )
}

export type Decoder = Pick<Of<unknown>, "decode">
export type Migrated<C extends Any> = { readonly current: C; readonly read: Decoder }

/** Older stored shapes go through `read` first; `current` describes what the store holds today. */
export function migrate<C extends Any>(current: C, read: Decoder): Migrated<C> {
  return { current, read }
}

function isMigrated<C extends Any>(definition: C | Migrated<C>): definition is Migrated<C> {
  return !isCodec(definition) && "current" in definition
}

// Stored values recover field by field against the initial value: an object's valid fields are
// kept, invalid or missing ones take their initial counterpart, and the result is merged over the
// initial so new fields appear with their defaults. Mirrors `Persistence.withInitial`.
export function withInitial<C extends Any>(definition: C | Migrated<C>, initial: Type<C>): Of<Type<C>, unknown> {
  const codec = isMigrated(definition) ? definition.current : definition
  const read = isMigrated(definition) ? definition.read : unknown
  return make(
    (input) => {
      const stored = read.decode(input)
      if (stored === INVALID) return INVALID
      return merge(initial, recover(codec, stored, initial))
    },
    (value) => codec.encode(value),
  )
}

function recover(codec: Any, value: unknown, initial: unknown): unknown {
  if (value === undefined) return initial
  if ("fields" in codec && isObject(value)) {
    const fields = (codec as Struct<Fields>).fields
    return Object.fromEntries(
      Object.entries(fields).flatMap(([name, field]) => {
        const defaults = isObject(initial) ? initial[name] : undefined
        const next = recover(field, value[name], defaults)
        if (next === undefined && !Object.hasOwn(value, name) && defaults === undefined) return []
        return [[name, next]]
      }),
    )
  }
  const decoded = codec.decode(value)
  return decoded === INVALID ? initial : decoded
}

function merge(initial: unknown, value: unknown): unknown {
  if (value === undefined) return initial
  if (!isObject(initial) || !isObject(value)) return value
  return Object.fromEntries(
    [...new Set([...Object.keys(initial), ...Object.keys(value)])].map((key) => [key, merge(initial[key], value[key])]),
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

