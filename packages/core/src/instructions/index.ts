export * as Instructions from "./index"

import { createHash } from "crypto"
import { Instruction } from "@opencode-ai/schema/instruction"
import { Effect, Option, Schema } from "effect"

export const Key = Instruction.Key
export type Key = Instruction.Key
export const Hash = Instruction.Hash
export type Hash = Instruction.Hash
export const Values = Instruction.Values
export type Values = Instruction.Values
export const Delta = Instruction.Delta
export type Delta = Instruction.Delta

export const unavailable = Symbol.for("@opencode/Instructions.Unavailable")
export type Unavailable = typeof unavailable

export const removed = Symbol.for("@opencode/Instructions.Removed")
export type Removed = typeof removed

export interface Source<A> {
  readonly key: Key
  readonly codec: Schema.Codec<A, Schema.Json>
  readonly read: Effect.Effect<A | Unavailable | Removed>
  readonly render: {
    readonly first: (current: A) => string
    readonly changed: (previous: A, current: A) => string
    readonly removed?: (previous: A) => string
  }
}

const InstructionsTypeId: unique symbol = Symbol.for("@opencode/Instructions")

export interface Instructions {
  readonly [InstructionsTypeId]: ReadonlyArray<PackedSource>
}

interface PackedSource {
  readonly key: Key
  readonly read: Effect.Effect<Schema.Json | Unavailable | Removed>
  readonly first: (value: Schema.Json) => string | undefined
  readonly changed: (previous: Schema.Json, current: Schema.Json) => string | undefined
  readonly removed: (previous: Schema.Json) => string | undefined
}

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

export const empty = instructions([])

export function make<A>(source: Source<A>): Instructions {
  const decode = Schema.decodeUnknownOption(source.codec)
  const encode = Schema.encodeSync(source.codec)
  const first = (value: A) => requireText(source.key, "first", source.render.first(value))
  const decodeValue = (value: Schema.Json) => Option.getOrUndefined(decode(value))
  return instructions([
    {
      key: source.key,
      read: source.read.pipe(
        Effect.map((value): Schema.Json | Unavailable | Removed => {
          if (value === unavailable) return unavailable
          if (value === removed) return removed
          return encode(value)
        }),
      ),
      first: (value) => {
        const decoded = decodeValue(value)
        return decoded === undefined ? undefined : first(decoded)
      },
      changed: (previous, current) => {
        const before = decodeValue(previous)
        const after = decodeValue(current)
        if (after === undefined) return undefined
        if (before === undefined) return first(after)
        return requireText(source.key, "changed", source.render.changed(before, after))
      },
      removed: (previous) => {
        const decoded = decodeValue(previous)
        return decoded === undefined || source.render.removed === undefined
          ? undefined
          : requireText(source.key, "removed", source.render.removed(decoded))
      },
    },
  ])
}

export function combine(values: ReadonlyArray<Instructions>): Instructions {
  const sources = values.flatMap((value) => value[InstructionsTypeId])
  const keys = new Set<Key>()
  for (const source of sources) {
    if (keys.has(source.key)) throw new DuplicateKeyError({ key: source.key })
    keys.add(source.key)
  }
  return instructions(sources)
}

export function read(value: Instructions): Effect.Effect<ReadResult> {
  return Effect.forEach(
    value[InstructionsTypeId],
    (source) =>
      source.read.pipe(
        Effect.map((observed): ReadResult[number] => {
          if (observed === unavailable) return { key: source.key, value: unavailable }
          if (observed === removed) return { key: source.key, value: removed }
          return { key: source.key, value: observed }
        }),
      ),
    { concurrency: "unbounded" },
  )
}

export function diff(observed: ReadResult, previous?: Values): Effect.Effect<Admission, InitializationBlocked> {
  const blocked = previous ? [] : observed.flatMap((entry) => (entry.value === unavailable ? [entry.key] : []))
  if (blocked.length > 0) return Effect.fail(new InitializationBlocked({ keys: blocked }))
  const delta: Record<string, Hash | Instruction.Removed> = {}
  const blobs: Record<string, Schema.Json> = {}
  for (const entry of observed) {
    if (entry.value === unavailable) continue
    if (entry.value === removed) {
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
    value[InstructionsTypeId].flatMap((source) => {
      if (!Object.hasOwn(values, source.key)) return []
      const text = source.first(values[source.key])
      return text === undefined ? [] : [text]
    }),
  )
}

export function renderUpdate(
  value: Instructions,
  previous: Readonly<Record<string, Schema.Json>>,
  delta: Readonly<Record<string, Schema.Json | null>>,
) {
  return render(
    value[InstructionsTypeId].flatMap((source) => {
      if (!Object.hasOwn(delta, source.key)) return []
      const current = delta[source.key]
      if (current === null) {
        if (!Object.hasOwn(previous, source.key)) return []
        const text = source.removed(previous[source.key])
        return text === undefined ? [] : [text]
      }
      const text = Object.hasOwn(previous, source.key)
        ? source.changed(previous[source.key], current)
        : source.first(current)
      return text === undefined ? [] : [text]
    }),
  )
}

export function hash(value: Schema.Json) {
  return Hash.make(createHash("sha256").update(canonical(value)).digest("hex"))
}

export function applyDelta<A>(
  values: Readonly<Record<string, A>>,
  delta: Readonly<Record<string, A | null>>,
): Readonly<Record<string, A>> {
  const result: Record<string, A> = { ...values }
  for (const [key, value] of Object.entries(delta)) {
    if (value === null) delete result[key]
    else result[key] = value
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

function instructions(sources: ReadonlyArray<PackedSource>): Instructions {
  return { [InstructionsTypeId]: sources }
}

function render(parts: ReadonlyArray<string>) {
  return parts.join("\n\n")
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
