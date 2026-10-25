import { Effect, Option, Schema, SchemaGetter } from "effect"
import { titleNumber } from "./title"

// Same recovery rules as the host's persistence schema helpers, so stored terminals decode as before.
function fallback<S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S, value: () => S["Type"]) {
  const defaulted = Schema.withDecodingDefaultType<S>(Effect.sync(value))(schema)

  return Schema.catchDecoding<typeof defaulted>(() => Effect.sync(() => Option.some(value())))(defaulted)
}

function optional<S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S) {
  const field = Schema.optional(schema)

  return Schema.catchDecoding<typeof field>(() => Effect.succeed(Option.none()))(field)
}

// Recover individual entries rather than discarding the whole collection.
function array<S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S) {
  const decode = Schema.decodeUnknownOption(schema)
  const encode = Schema.encodeSync(schema)

  return fallback(
    Schema.Array(Schema.Unknown).pipe(
      Schema.decodeTo(Schema.Array(Schema.toType(schema)), {
        decode: SchemaGetter.transform((items) => items.flatMap((item) => Option.toArray(decode(item)))),
        encode: SchemaGetter.transform((items) => items.map((item) => encode(item))),
      }),
    ),
    () => [],
  )
}

const PTY = Schema.Struct({
  id: Schema.NonEmptyString,
  title: fallback(Schema.String, () => ""),
  titleNumber: fallback(Schema.Finite, () => 0),
  rows: optional(Schema.Finite),
  cols: optional(Schema.Finite),
  buffer: optional(Schema.String),
  scrollY: optional(Schema.Finite),
  cursor: optional(Schema.Finite),
})

export type LocalPTY = typeof PTY.Type

export const MAX_TERMINAL_SESSIONS = 20

export function numberFromTitle(title: string) {
  return titleNumber(title, MAX_TERMINAL_SESSIONS)
}

const State = Schema.Struct({
  active: optional(Schema.String),
  all: array(PTY),
})

export const TerminalState = State.pipe(
  Schema.decodeTo(Schema.toType(State), {
    decode: SchemaGetter.transform((value) => {
      const seen = new Set<string>()

      const all = value.all.flatMap((pty) => {
        if (seen.has(pty.id)) return []
        seen.add(pty.id)

        return [{ ...pty, titleNumber: pty.titleNumber > 0 ? pty.titleNumber : (numberFromTitle(pty.title) ?? 0) }]
      })

      return {
        active: value.active && seen.has(value.active) ? value.active : all[0]?.id,
        all,
      }
    }),
    encode: SchemaGetter.transform((value) => value),
  }),
)
