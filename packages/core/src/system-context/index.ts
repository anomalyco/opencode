export * as SystemContext from "./index"

import { Effect, Option, Schema } from "effect"

/**
 * Models privileged system context as independently refreshable typed sources.
 *
 * `Source<A>` describes how to observe, compare, and render one value. `make`
 * closes over `A`, producing an opaque `SystemContext` that composes uniformly
 * with contexts built from other value types. Interpreters observe the composed
 * context once, then produce a durable structured
 * `Snapshot` alongside the exact model-visible baseline or update text.
 *
 * Returning `unavailable` means observation failed temporarily. It differs from
 * removing a source from the context: refresh preserves the admitted snapshot,
 * and replacement waits rather than silently constructing an incomplete baseline.
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

/** Durable comparison state for one admitted source. */
export const SourceSnapshot = Schema.Struct({
  value: Schema.Json,
  removed: Schema.optional(Schema.NonEmptyString),
})
export type SourceSnapshot = typeof SourceSnapshot.Type

/** Durable structured comparison state for one active context generation. */
export const Snapshot = Schema.Record(Key, SourceSnapshot)
export type Snapshot = Readonly<Record<string, SourceSnapshot>>

export interface Generation {
  readonly baseline: string
  readonly snapshot: Snapshot
}

export interface Updated {
  readonly _tag: "Updated"
  readonly text: string
  readonly snapshot: Snapshot
}

export interface ReplacementReady {
  readonly _tag: "ReplacementReady"
  readonly generation: Generation
}

export interface ReplacementBlocked {
  readonly _tag: "ReplacementBlocked"
}

export type ReplacementResult = ReplacementReady | ReplacementBlocked
export type ReconcileResult = { readonly _tag: "Unchanged" } | Updated | ReplacementResult

export class InitializationBlocked extends Schema.TaggedErrorClass<InitializationBlocked>()(
  "SystemContext.InitializationBlocked",
  { keys: Schema.Array(Key) },
) {}

export class DuplicateKeyError extends Schema.TaggedErrorClass<DuplicateKeyError>()("SystemContext.DuplicateKeyError", {
  key: Key,
}) {
  override get message() {
    return `Duplicate system context key: ${this.key}`
  }
}

interface PackedSource {
  readonly key: Key
  readonly load: Effect.Effect<Loaded | Unavailable>
}

interface Loaded {
  readonly baseline: () => Rendered
  readonly compare: (previous: Schema.Json) => Compared
}

interface Rendered {
  readonly text: string
  readonly snapshot: SourceSnapshot
}

type Compared =
  | { readonly _tag: "Incompatible" }
  | { readonly _tag: "Unchanged" }
  | { readonly _tag: "Updated"; readonly render: () => Rendered }

interface AvailableEntry extends Loaded {
  readonly _tag: "Available"
  readonly key: Key
}

interface UnavailableEntry {
  readonly _tag: "Unavailable"
  readonly key: Key
}

type Entry = AvailableEntry | UnavailableEntry

/** The identity context. */
export const empty = context([])

/** Closes a typed source into a context that composes with differently typed sources. */
export function make<A>(source: Source<A>): SystemContext {
  const decode = Schema.decodeUnknownOption(source.codec)
  const encode = Schema.encodeSync(source.codec)
  const equivalent = Schema.toEquivalence(source.codec)
  return context([
    {
      key: source.key,
      load: source.load.pipe(
        Effect.map((value) => {
          if (isUnavailable(value)) return value
          const snapshot = (): SourceSnapshot => ({
            value: encode(value),
            ...(source.removed ? { removed: requireText(source.key, "removal", source.removed(value)) } : {}),
          })
          return {
            baseline: (): Rendered => ({
              text: requireText(source.key, "baseline", source.baseline(value)),
              snapshot: snapshot(),
            }),
            compare: (previous): Compared =>
              Option.match(decode(previous), {
                onNone: (): Compared => ({ _tag: "Incompatible" }),
                onSome: (decoded): Compared =>
                  equivalent(decoded, value)
                    ? { _tag: "Unchanged" }
                    : {
                        _tag: "Updated",
                        render: () => ({
                          text: requireText(source.key, "update", source.update(decoded, value)),
                          snapshot: snapshot(),
                        }),
                      },
              }),
          }
        }),
      ),
    },
  ])
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
      source.load.pipe(
        Effect.map(
          (result): Entry =>
            result === unavailable
              ? { _tag: "Unavailable", key: source.key }
              : { _tag: "Available", key: source.key, ...result },
        ),
      ),
    { concurrency: "unbounded" },
  )

/** Creates the immutable baseline and durable snapshot for a new generation. */
export function initialize(value: SystemContext): Effect.Effect<Generation, InitializationBlocked> {
  return observe(value).pipe(
    Effect.flatMap((entries) => {
      const unavailable = entries.flatMap((entry) => (entry._tag === "Unavailable" ? [entry.key] : []))
      if (unavailable.length > 0) return new InitializationBlocked({ keys: unavailable })
      return Effect.succeed(initializeObservation(entries))
    }),
  )
}

function initializeObservation(entries: ReadonlyArray<Entry>): Generation {
  const available = entries.filter((entry): entry is AvailableEntry => entry._tag === "Available")
  const rendered = available.map((entry) => [entry.key, entry.baseline()] as const)
  return {
    baseline: render(rendered.map(([, result]) => result.text)),
    snapshot: Object.fromEntries(rendered.map(([key, result]) => [key, result.snapshot])),
  }
}

/** Reconciles current source values with one active generation. */
export function reconcile(value: SystemContext, previous: Snapshot): Effect.Effect<ReconcileResult> {
  return observe(value).pipe(
    Effect.map((entries): ReconcileResult => {
      const result = reconcileObservation(entries, previous)
      if (result._tag === "Unchanged" || result._tag === "Updated") return result
      return replaceObservation(entries, previous)
    }),
  )
}

function reconcileObservation(
  entries: ReadonlyArray<Entry>,
  previous: Snapshot,
): { readonly _tag: "Unchanged" } | Updated | { readonly _tag: "Replace" } {
  const keys = new Set(entries.map((entry) => entry.key))
  const comparisons = new Map<Key, Compared>()
  for (const entry of entries) {
    if (entry._tag === "Unavailable") continue
    const stored = getSnapshot(previous, entry.key)
    if (!stored) continue
    const compared = entry.compare(stored.value)
    if (compared._tag === "Incompatible") return { _tag: "Replace" }
    comparisons.set(entry.key, compared)
  }
  for (const key of Object.keys(previous).sort()) {
    if (keys.has(Key.make(key))) continue
    if (previous[key].removed === undefined) return { _tag: "Replace" }
  }

  const snapshot: Record<string, SourceSnapshot> = {}
  const updates: string[] = []
  for (const entry of entries) {
    const stored = getSnapshot(previous, entry.key)
    if (entry._tag === "Unavailable") {
      if (stored) snapshot[entry.key] = stored
      continue
    }
    if (!stored) {
      const rendered = entry.baseline()
      updates.push(rendered.text)
      snapshot[entry.key] = rendered.snapshot
      continue
    }
    const compared = comparisons.get(entry.key)
    if (!compared || compared._tag === "Incompatible")
      throw new Error(`Missing comparison for system context source ${entry.key}`)
    if (compared._tag === "Unchanged") {
      snapshot[entry.key] = stored
      continue
    }
    const rendered = compared.render()
    updates.push(rendered.text)
    snapshot[entry.key] = rendered.snapshot
  }
  for (const key of Object.keys(previous).sort()) {
    if (keys.has(Key.make(key))) continue
    const removed = previous[key].removed
    if (removed === undefined) throw new Error(`Missing removal rendering for system context source ${key}`)
    updates.push(removed)
  }
  if (updates.length === 0) return { _tag: "Unchanged" }
  return { _tag: "Updated", text: render(updates), snapshot }
}

/** Creates a complete replacement generation or blocks while admitted context is unavailable. */
export function replace(value: SystemContext, previous: Snapshot): Effect.Effect<ReplacementResult> {
  return observe(value).pipe(Effect.map((entries) => replaceObservation(entries, previous)))
}

function replaceObservation(entries: ReadonlyArray<Entry>, previous: Snapshot): ReplacementResult {
  if (entries.some((entry) => entry._tag === "Unavailable" && getSnapshot(previous, entry.key) !== undefined))
    return { _tag: "ReplacementBlocked" }
  return { _tag: "ReplacementReady", generation: initializeObservation(entries) }
}

function context(sources: ReadonlyArray<PackedSource>): SystemContext {
  return { [ContextTypeId]: sources }
}

function render(parts: ReadonlyArray<string>) {
  return parts.join("\n\n")
}

function getSnapshot(snapshot: Snapshot, key: Key) {
  return Object.hasOwn(snapshot, key) ? snapshot[key] : undefined
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
