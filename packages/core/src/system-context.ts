export * as SystemContext from "./system-context"

import { Effect, Schema } from "effect"
import { Hash } from "./util/hash"

export const Key = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*$/)).pipe(
  Schema.brand("SystemContext.Key"),
)
export type Key = typeof Key.Type

export const unavailable = Symbol.for("@opencode/SystemContext.Unavailable")
export type Unavailable = typeof unavailable

export interface Value {
  /** Full component text rendered into a new epoch baseline. */
  readonly baseline: string
  /** Absolute current-state text emitted when this component changes. */
  readonly update: string
}

export interface Component<out E = never, out R = never> {
  readonly key: Key
  readonly load: Effect.Effect<Value | Unavailable, E, R>
}

export interface SystemContext<out E = never, out R = never> {
  readonly components: ReadonlyArray<Component<E, R>>
}

export interface AvailableEntry extends Value {
  readonly _tag: "Available"
  readonly key: Key
  readonly hash: string
}

export interface UnavailableEntry {
  readonly _tag: "Unavailable"
  readonly key: Key
}

export type Entry = AvailableEntry | UnavailableEntry

export interface Snapshot {
  readonly entries: ReadonlyArray<Entry>
}

export interface Part {
  readonly key: Key
  readonly text: string
}

export type Checkpoint = Readonly<Record<string, string>>

export interface Initialized {
  readonly baseline: ReadonlyArray<Part>
  readonly checkpoint: Checkpoint
}

export interface Refreshed {
  readonly changes: ReadonlyArray<Part>
  readonly checkpoint: Checkpoint
}

export class DuplicateKeyError extends Schema.TaggedErrorClass<DuplicateKeyError>()("SystemContext.DuplicateKeyError", {
  key: Key,
}) {
  override get message() {
    return `Duplicate system context key: ${this.key}`
  }
}

export const value = <E, R>(component: Component<E, R>): Component<E, R> => component

export function struct<E, R>(components: Readonly<Record<string, Component<E, R>>>): SystemContext<E, R> {
  const values = Object.values(components)
  assertUniqueKeys(values)
  return { components: values }
}

export const load = <E, R>(context: SystemContext<E, R>) =>
  Effect.sync(() => assertUniqueKeys(context.components)).pipe(
    Effect.andThen(
      Effect.forEach(context.components, (component) =>
        component.load.pipe(
          Effect.map(
            (result): Entry =>
              result === unavailable
                ? { _tag: "Unavailable", key: component.key }
                : { _tag: "Available", key: component.key, ...result, hash: Hash.sha256(result.update) },
          ),
        ),
      ),
    ),
    Effect.map((entries): Snapshot => ({ entries })),
  )

export function initialize(snapshot: Snapshot): Initialized {
  return {
    baseline: snapshot.entries.flatMap((entry) =>
      entry._tag === "Available" ? [{ key: entry.key, text: entry.baseline }] : [],
    ),
    checkpoint: nextCheckpoint(snapshot, {}),
  }
}

export function refresh(snapshot: Snapshot, previous: Checkpoint): Refreshed {
  return {
    changes: snapshot.entries.flatMap((entry) =>
      entry._tag === "Available" && getCheckpoint(previous, entry.key) !== entry.hash
        ? [{ key: entry.key, text: entry.update }]
        : [],
    ),
    checkpoint: nextCheckpoint(snapshot, previous),
  }
}

export function render(parts: ReadonlyArray<Part>) {
  return parts.map((part) => part.text).join("\n\n")
}

function nextCheckpoint(snapshot: Snapshot, previous: Checkpoint) {
  return Object.fromEntries(
    snapshot.entries.flatMap((entry) => {
      if (entry._tag === "Available") return [[entry.key, entry.hash]]
      const hash = getCheckpoint(previous, entry.key)
      return hash === undefined ? [] : [[entry.key, hash]]
    }),
  )
}

function getCheckpoint(checkpoint: Checkpoint, key: Key) {
  return Object.hasOwn(checkpoint, key) ? checkpoint[key] : undefined
}

function assertUniqueKeys(components: ReadonlyArray<Component<unknown, unknown>>) {
  const keys = new Set<Key>()
  for (const component of components) {
    if (keys.has(component.key)) throw new DuplicateKeyError({ key: component.key })
    keys.add(component.key)
  }
}
