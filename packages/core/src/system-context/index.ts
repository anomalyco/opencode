export * as SystemContext from "./index"

import { Effect, Option, Schema } from "effect"

/**
 * Models privileged system context as independently refreshable typed sources.
 *
 * `Source<A>` describes how to observe, compare, and render one value. `make`
 * closes over `A`, producing an opaque `SystemContext` that composes uniformly
 * with contexts built from other value types.
 *
 * The durable `Applied` record tracks what the model was last told, per source:
 * it is the model's current belief. Interpreters uphold one invariant —
 * `reconcile` never rewrites the baseline; it only narrates drift as update
 * text. Only `rebaseline` (compaction) and `initialize` (first turn) produce
 * baseline text.
 *
 * Returning `unavailable` means observation failed temporarily. It differs from
 * removing a source from the context: the model's prior belief stands.
 * `reconcile` retains the applied value silently, and `rebaseline` restates the
 * belief by rendering the last-applied value instead of a live observation.
 *
 * @module
 */

/** Stable namespaced identity for one independently refreshable context source. */
export const Key = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*$/)).pipe(
  Schema.brand("SystemContext.Key"),
)
export type Key = typeof Key.Type

/** Indicates that a source could not be observed without treating it as removed. */
export const unavailable = Symbol.for("@opencode/SystemContext.Unavailable")
export type Unavailable = typeof unavailable

/** Defines one typed source before its value type is hidden by `make`. */
export interface Source<A> {
  readonly key: Key
  readonly codec: Schema.Codec<A, Schema.Json, never, never>
  readonly load: Effect.Effect<A | Unavailable>
  readonly baseline: (current: A) => string
  readonly update: (previous: A, current: A) => string
  readonly removed?: (previous: A) => string
}

const ContextTypeId: unique symbol = Symbol.for("@opencode/SystemContext")

/** Opaque carrier for composable system context sources. */
export interface SystemContext {
  readonly [ContextTypeId]: ReadonlyArray<PackedSource>
}

/** The value last applied to the model for one admitted source. */
export const AppliedSource = Schema.Struct({
  value: Schema.Json,
  removed: Schema.optional(Schema.NonEmptyString),
})
export type AppliedSource = typeof AppliedSource.Type

/** Durable record of what the model currently believes, per source. */
export const Applied = Schema.Record(Key, AppliedSource)
export type Applied = Readonly<Record<string, AppliedSource>>

/** A rendered baseline together with the applied values it was rendered from. */
export interface Baseline {
  readonly text: string
  readonly applied: Applied
}

export interface Updated {
  readonly _tag: "Updated"
  readonly text: string
  readonly applied: Applied
}

export type ReconcileResult = { readonly _tag: "Unchanged" } | Updated

export class InitializationBlocked extends Schema.TaggedErrorClass<InitializationBlocked>()(
  "SystemContext.InitializationBlocked",
  { keys: Schema.Array(Key) },
) {
  override get message() {
    return `System context initialization blocked by unavailable sources: ${this.keys.join(", ")}`
  }
}

export class DuplicateKeyError extends Schema.TaggedErrorClass<DuplicateKeyError>()("SystemContext.DuplicateKeyError", {
  key: Key,
}) {
  override get message() {
    return `Duplicate system context key: ${this.key}`
  }
}

interface PackedSource {
  readonly key: Key
  readonly load: Effect.Effect<Observed | Unavailable>
  /** Restates the model's belief from a last-applied value when the source cannot be observed. */
  readonly recall: (stored: AppliedSource) => string | undefined
}

interface Observed {
  readonly applied: AppliedSource
  readonly baseline: () => string
  /** `undefined` means unchanged. An undecodable previous value re-renders the baseline (treat-as-new). */
  readonly update: (previous: AppliedSource) => string | undefined
}

interface Entry {
  readonly key: Key
  readonly recall: PackedSource["recall"]
  readonly observed: Observed | Unavailable
}

/** The identity context. */
export const empty = context([])

/** Closes a typed source into a context that composes with differently typed sources. */
export function make<A>(source: Source<A>): SystemContext {
  const decode = Schema.decodeUnknownOption(source.codec)
  const encode = Schema.encodeSync(source.codec)
  const equivalent = Schema.toEquivalence(source.codec)
  const baseline = (value: A) => requireText(source.key, "baseline", source.baseline(value))
  return context([
    {
      key: source.key,
      recall: (stored) =>
        Option.match(decode(stored.value), {
          onNone: () => undefined,
          onSome: baseline,
        }),
      load: source.load.pipe(
        Effect.map((value) => {
          if (isUnavailable(value)) return value
          return {
            applied: {
              value: encode(value),
              ...(source.removed ? { removed: requireText(source.key, "removal", source.removed(value)) } : {}),
            },
            baseline: () => baseline(value),
            update: (previous) =>
              Option.match(decode(previous.value), {
                onNone: () => baseline(value),
                onSome: (decoded) =>
                  equivalent(decoded, value)
                    ? undefined
                    : requireText(source.key, "update", source.update(decoded, value)),
              }),
          } satisfies Observed
        }),
      ),
    },
  ])
}

/**
 * Keyed three-way diff for list-shaped sources rendering delta updates.
 * `changed` compares two values sharing a key; entries equal under it are dropped.
 */
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

/** Combines contexts in order and rejects duplicate source keys immediately. */
export function combine(values: ReadonlyArray<SystemContext>): SystemContext {
  const sources = values.flatMap((value) => value[ContextTypeId])
  assertUniqueKeys(sources)
  return context(sources)
}

const observe = (value: SystemContext) =>
  Effect.forEach(
    value[ContextTypeId],
    (source) =>
      source.load.pipe(Effect.map((observed): Entry => ({ key: source.key, recall: source.recall, observed }))),
    { concurrency: "unbounded" },
  )

/** Creates the first baseline. Blocks rather than admit a baseline missing an unobservable source. */
export function initialize(value: SystemContext): Effect.Effect<Baseline, InitializationBlocked> {
  return observe(value).pipe(
    Effect.flatMap((entries) => {
      const blocked = entries.flatMap((entry) => (entry.observed === unavailable ? [entry.key] : []))
      if (blocked.length > 0) return new InitializationBlocked({ keys: blocked })
      const parts: string[] = []
      const applied: Record<string, AppliedSource> = {}
      for (const entry of entries) {
        if (entry.observed === unavailable) continue
        parts.push(entry.observed.baseline())
        applied[entry.key] = entry.observed.applied
      }
      return Effect.succeed({ text: render(parts), applied })
    }),
  )
}

/** Narrates drift between current source values and the model's beliefs. Never rewrites the baseline. */
export function reconcile(value: SystemContext, previous: Applied): Effect.Effect<ReconcileResult> {
  return observe(value).pipe(
    Effect.map((entries): ReconcileResult => {
      const updates: string[] = []
      const applied: Record<string, AppliedSource> = {}
      for (const entry of entries) {
        const stored = get(previous, entry.key)
        if (entry.observed === unavailable) {
          // The prior belief stands while the source cannot be observed.
          if (stored) applied[entry.key] = stored
          continue
        }
        if (!stored) {
          updates.push(entry.observed.baseline())
          applied[entry.key] = entry.observed.applied
          continue
        }
        const text = entry.observed.update(stored)
        if (text === undefined) {
          applied[entry.key] = stored
          continue
        }
        updates.push(text)
        applied[entry.key] = entry.observed.applied
      }
      const keys = new Set<string>(entries.map((entry) => entry.key))
      for (const key of Object.keys(previous).sort()) {
        if (keys.has(key)) continue
        const removed = previous[key].removed
        // An unannounced removal retains the belief; it clears at the next rebaseline.
        if (removed === undefined) applied[key] = previous[key]
        else updates.push(removed)
      }
      if (updates.length === 0) return { _tag: "Unchanged" }
      return { _tag: "Updated", text: render(updates), applied }
    }),
  )
}

/** Rebuilds the baseline, restating unobservable sources from the model's last-applied beliefs. */
export function rebaseline(value: SystemContext, previous: Applied): Effect.Effect<Baseline> {
  return observe(value).pipe(
    Effect.map((entries): Baseline => {
      const parts: string[] = []
      const applied: Record<string, AppliedSource> = {}
      for (const entry of entries) {
        if (entry.observed !== unavailable) {
          parts.push(entry.observed.baseline())
          applied[entry.key] = entry.observed.applied
          continue
        }
        const stored = get(previous, entry.key)
        if (!stored) continue
        const text = entry.recall(stored)
        // An undecodable belief cannot be restated; the source re-announces when observable again.
        if (text === undefined) continue
        parts.push(text)
        applied[entry.key] = stored
      }
      return { text: render(parts), applied }
    }),
  )
}

function context(sources: ReadonlyArray<PackedSource>): SystemContext {
  return { [ContextTypeId]: sources }
}

function render(parts: ReadonlyArray<string>) {
  return parts.join("\n\n")
}

function get(applied: Applied, key: Key) {
  return Object.hasOwn(applied, key) ? applied[key] : undefined
}

function isUnavailable(value: unknown): value is Unavailable {
  return value === unavailable
}

function requireText(key: Key, kind: string, text: string) {
  if (text.length === 0) throw new Error(`System context source ${key} rendered an empty ${kind}`)
  return text
}

function assertUniqueKeys(sources: ReadonlyArray<PackedSource>) {
  const keys = new Set<Key>()
  for (const source of sources) {
    if (keys.has(source.key)) throw new DuplicateKeyError({ key: source.key })
    keys.add(source.key)
  }
}
