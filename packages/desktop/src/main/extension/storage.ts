import type { MainStoreFrom, Storage } from "@opencode/gui-extensions/sdk/main"
import { Option, Schema } from "effect"
import type { StateStore } from "../storage/state"
import type { SettingsStore } from "../storage/store"

/** The last value a store read or wrote, so later reads skip the database. */
type Cached<T> = { value?: { current: T } }

/** A desktop settings file by name; the app's own when the name is left out. */
export type SettingsFiles = (file?: string) => SettingsStore

/**
 * Each extension's values live in the `state` table under `extension.<id>`, stored as canonical JSON. Writes are rare,
 * so each one reaches the database before it returns and survives a crash. A `from` imports an older value once from
 * a settings file or another state namespace.
 */
export function createStorage(state: StateStore, settings: SettingsFiles, id: string): Storage {
  const name = namespace(id)
  // Resets the caches of the stores opened on each key since its last removal, so they read `initial` again.
  const opened = new Map<string, Set<() => void>>()

  const sources = (from: MainStoreFrom | readonly MainStoreFrom[] | undefined) =>
    [from ?? []].flat().map((item) => source(state, settings, item))

  const remove = (key: string, from: MainStoreFrom | readonly MainStoreFrom[] | undefined) => {
    // The old copies go too, or the next read would import one again.
    sources(from).forEach((older) => older.remove())

    if (state.get(name, key) !== null) state.delete(name, key)
    state.flush()
    opened.get(key)?.forEach((reset) => reset())
    opened.delete(key)
  }

  return {
    store(key, options) {
      const codec = Schema.toCodecJson(options.schema)
      const legacy = sources(options.from)
      const cached: Cached<typeof options.initial> = {}

      const read = () => {
        const stored = state.get(name, key)

        if (stored !== null) return Schema.decodeUnknownOption(Schema.fromJsonString(codec))(stored)
        // The newest older home that holds a value.
        const found = legacy.find((older) => older.read() !== undefined)?.read()

        if (found === undefined) return Option.none()
        const decoded = Schema.decodeUnknownOption(codec)(found)

        // Imported once; the old location keeps its copy for builds that still read it.
        if (Option.isSome(decoded)) state.set(name, key, JSON.stringify(found))

        return decoded
      }

      const current = () => {
        cached.value ??= { current: Option.getOrElse(read(), () => options.initial) }

        return cached.value.current
      }

      // Keeps a decoded copy of what was stored, so the caller's object never aliases the stored value.
      const write = (value: typeof options.initial) => {
        const encoded = Schema.encodeSync(codec)(value)

        state.set(name, key, JSON.stringify(encoded))
        state.flush()
        cached.value = { current: Schema.decodeSync(codec)(encoded) }
      }

      const resets = opened.get(key) ?? new Set()

      resets.add(() => {
        cached.value = { current: options.initial }
      })
      opened.set(key, resets)

      return {
        get value() {
          return current()
        },
        ready: () => true,
        // The draft is a decoded copy, so a mutation never touches the cached value until it is written. A returned
        // value replaces the draft.
        update(mutation) {
          const draft = Schema.decodeSync(codec)(Schema.encodeSync(codec)(current()))
          const next = mutation(draft)

          write(next === undefined ? draft : next)
        },
      }
    },
    remove: (key, options) => remove(key, options?.from),
  }
}

export function namespace(id: string) {
  return `extension.${id}`
}

/** One older home: a key of a settings file, or of another state namespace. */
function source(state: StateStore, settings: SettingsFiles, from: MainStoreFrom) {
  if ("settings" in from) {
    const store = () => settings(from.file)

    return {
      read: () => store().get(from.settings),
      remove() {
        if (store().get(from.settings) !== undefined) store().delete(from.settings)
      },
    }
  }

  const [space, key] = from.state

  return {
    read() {
      const value = state.get(space, key)

      if (value === null) return undefined

      return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(value))
    },
    remove() {
      if (state.get(space, key) !== null) state.delete(space, key)
    },
  }
}
