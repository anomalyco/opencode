export * as Instructions from "./index"

import { createHash } from "crypto"
import { Instruction } from "@opencode-ai/schema/instruction"
import { Data, Effect, Option, Schema } from "effect"

export const Key = Instruction.Key
export type Key = Instruction.Key
export const Hash = Instruction.Hash
export type Hash = Instruction.Hash
export const Values = Instruction.Values
export type Values = Instruction.Values
export const Delta = Instruction.Delta
export type Delta = Instruction.Delta

type NonValue = Data.TaggedEnum<{ Unavailable: {}; Removed: {} }>
const NonValue = Data.taggedEnum<NonValue>()

/** The read failed temporarily; the stored value stands. */
export const unavailable = NonValue.Unavailable()
export type Unavailable = typeof unavailable

/** An observed absence: the source exists but its value is gone. */
export const removed = NonValue.Removed()
export type Removed = typeof removed

/**
 * One composable instruction source over canonical JSON — the same
 * representation that is hashed, stored, and replayed. `make` builds one from
 * a typed definition; renderers returning `undefined` skip (undecodable or
 * unrenderable historical values).
 */
export interface Source {
  readonly key: Key
  readonly read: Effect.Effect<Schema.Json | Unavailable | Removed>
  readonly initial: (value: Schema.Json) => string | undefined
  readonly changed: (previous: Schema.Json, current: Schema.Json) => string | undefined
  readonly removed: (previous: Schema.Json) => string | undefined
}

export declare namespace Source {
  /** The typed definition supplied when constructing a source. */
  export interface Definition<A> {
    readonly key: Key
    readonly codec: Schema.Codec<A, Schema.Json>
    readonly read: Effect.Effect<A | Unavailable | Removed>
    readonly render: {
      readonly initial: (current: A) => string
      readonly changed: (previous: A, current: A) => string
      readonly removed?: (previous: A) => string
    }
  }
}

/** Ordered sources; identical values render identical bytes. */
export type Instructions = ReadonlyArray<Source>

export type ReadResult = ReadonlyArray<{
  readonly key: Key
  readonly value: Schema.Json | Unavailable | Removed
}>

export interface Admission {
  readonly delta: Delta
  readonly blobs: Readonly<Record<string, Schema.Json>>
}

export class InitializationBlocked extends Schema.TaggedErrorClass<InitializationBlocked>()(
  "Instructions.InitializationBlocked",
  { keys: Schema.Array(Key) },
) {
  override get message() {
    return `Instruction initialization blocked by unavailable sources: ${this.keys.join(", ")}`
  }
}

export class DuplicateKeyError extends Schema.TaggedErrorClass<DuplicateKeyError>()("Instructions.DuplicateKeyError", {
  key: Key,
}) {
  override get message() {
    return `Duplicate instruction key: ${this.key}`
  }
}

export const empty: Instructions = []

/** Closes a typed definition into one `Source`, so differently typed sources compose. */
export function make<A>(source: Source.Definition<A>): Instructions {
  const decode = Schema.decodeUnknownOption(source.codec)
  const encode = Schema.encodeSync(source.codec)
  const initial = (value: A) => requireText(source.key, "initial", source.render.initial(value))
  const decodeValue = (value: Schema.Json) => Option.getOrUndefined(decode(value))
  return [
    {
      key: source.key,
      read: source.read.pipe(
        Effect.map((value) => {
          if (isUnavailable(value)) return unavailable
          if (isRemoved(value)) return removed
          return encode(value)
        }),
      ),
      initial: (value) => {
        const decoded = decodeValue(value)
        return decoded === undefined ? undefined : initial(decoded)
      },
      changed: (previous, current) => {
        const before = decodeValue(previous)
        const after = decodeValue(current)
        if (after === undefined) return undefined
        if (before === undefined) return initial(after)
        return requireText(source.key, "changed", source.render.changed(before, after))
      },
      removed: (previous) => {
        const decoded = decodeValue(previous)
        return decoded === undefined || source.render.removed === undefined
          ? undefined
          : requireText(source.key, "removed", source.render.removed(decoded))
      },
    },
  ]
}

export function combine(values: ReadonlyArray<Instructions>): Instructions {
  const sources = values.flat()
  const keys = new Set<Key>()
  for (const source of sources) {
    if (keys.has(source.key)) throw new DuplicateKeyError({ key: source.key })
    keys.add(source.key)
  }
  return sources
}

export function read(value: Instructions): Effect.Effect<ReadResult> {
  return Effect.forEach(
    value,
    (source) => source.read.pipe(Effect.map((observed) => ({ key: source.key, value: observed }))),
    { concurrency: "unbounded" },
  )
}

export function diff(observed: ReadResult, previous?: Values): Effect.Effect<Admission, InitializationBlocked> {
  const blocked = previous ? [] : observed.flatMap((entry) => (isUnavailable(entry.value) ? [entry.key] : []))
  if (blocked.length > 0) return Effect.fail(new InitializationBlocked({ keys: blocked }))
  const delta: Record<string, Hash | Instruction.Removed> = {}
  const blobs: Record<string, Schema.Json> = {}
  for (const entry of observed) {
    if (isUnavailable(entry.value)) continue
    if (isRemoved(entry.value)) {
      if (previous && Object.hasOwn(previous, entry.key)) delta[entry.key] = Instruction.removed
      continue
    }
    const next = hash(entry.value)
    if (previous?.[entry.key] === next) continue
    delta[entry.key] = next
    blobs[next] = entry.value
  }
  return Effect.succeed({ delta, blobs })
}

export function renderInitial(value: Instructions, values: Readonly<Record<string, Schema.Json>>) {
  return render(
    value.flatMap((source) => {
      if (!Object.hasOwn(values, source.key)) return []
      const text = source.initial(values[source.key])
      return text === undefined ? [] : [text]
    }),
  )
}

export function renderUpdate(
  value: Instructions,
  previous: Readonly<Record<string, Schema.Json>>,
  delta: Readonly<Record<string, Option.Option<Schema.Json>>>,
) {
  return render(
    value.flatMap((source) => {
      if (!Object.hasOwn(delta, source.key)) return []
      const current = delta[source.key]
      if (Option.isNone(current)) {
        if (!Object.hasOwn(previous, source.key)) return []
        const text = source.removed(previous[source.key])
        return text === undefined ? [] : [text]
      }
      const next = current.value
      const text = Object.hasOwn(previous, source.key)
        ? source.changed(previous[source.key], next)
        : source.initial(next)
      return text === undefined ? [] : [text]
    }),
  )
}

export function hash(value: Schema.Json) {
  return Hash.make(createHash("sha256").update(canonical(value)).digest("hex"))
}

export function applyDelta(
  values: Readonly<Record<string, Schema.Json>>,
  delta: Readonly<Record<string, Option.Option<Schema.Json>>>,
): Readonly<Record<string, Schema.Json>> {
  const result: Record<string, Schema.Json> = { ...values }
  for (const [key, value] of Object.entries(delta)) {
    if (Option.isNone(value)) delete result[key]
    else result[key] = value.value
  }
  return result
}

export function applyHashDelta(values: Values, delta: Delta): Values {
  const result: Record<string, Hash> = { ...values }
  for (const [key, value] of Object.entries(delta)) {
    if (value === Instruction.removed) delete result[key]
    else result[key] = value
  }
  return result
}

export function diffByKey<A>(
  previous: ReadonlyArray<A>,
  current: ReadonlyArray<A>,
  key: (value: A) => string,
  changed: (previous: A, current: A) => boolean,
): {
  readonly added: ReadonlyArray<A>
  readonly removed: ReadonlyArray<A>
  readonly changed: ReadonlyArray<{ readonly previous: A; readonly current: A }>
} {
  const currentKeys = new Set(current.map(key))
  const previousByKey = new Map(previous.map((value) => [key(value), value] as const))
  return {
    added: current.filter((value) => !previousByKey.has(key(value))),
    removed: previous.filter((value) => !currentKeys.has(key(value))),
    changed: current.flatMap((value) => {
      const before = previousByKey.get(key(value))
      return before === undefined || !changed(before, value) ? [] : [{ previous: before, current: value }]
    }),
  }
}

function render(parts: ReadonlyArray<string>) {
  return parts.join("\n\n")
}

// Reference-equality guards: `A` in a typed source may itself be JSON shaped
// like these singletons, so identity, never structure, discriminates.
function isUnavailable(value: unknown): value is Unavailable {
  return value === unavailable
}

function isRemoved(value: unknown): value is Removed {
  return value === removed
}

function canonical(value: Schema.Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`
  return JSON.stringify(value)
}

function requireText(key: Key, kind: string, text: string) {
  if (text.length === 0) throw new Error(`Instruction source ${key} rendered an empty ${kind}`)
  return text
}
