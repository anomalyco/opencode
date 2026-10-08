import type { MainStoreFrom, Mutable, Storage } from "@opencode/gui-extensions/sdk/main"
import { Option, Schema } from "effect"
import type { StateStore } from "../storage/state"
import type { SettingsStore } from "../storage/store"

/**
 * One key as every store opened on it sees it: the stored JSON last read or written, so later reads skip the database.
 * Undefined until read; null while nothing is stored, including after `remove`, so each store reads its `initial`.
 */
type Shared = { json?: string | null }

/** One store's decoded copy of the shared JSON, decoded again when another store on the key writes. */
type Decoded<T> = { value?: { readonly json: string | null; readonly current: T } }

/** A desktop settings file by name; the app's own when the name is left out. */
export type SettingsFiles = (file?: string) => SettingsStore

/**
 * Each extension's values live in the `state` table under `extension.<id>`, stored as canonical JSON. Writes are rare,
 * so each one reaches the database before it returns and survives a crash. A `from` imports an older value once from
 * a settings file or another state namespace.
 */
export function createStorage(state: StateStore, settings: SettingsFiles, id: string): Storage {
  const name = namespace(id)
  // Every store opened on a key shares its entry, so a write through one is what the others read.
  const keys = new Map<string, Shared>()

  const shared = (key: string) => {
    const existing = keys.get(key)

    if (existing) return existing
    const created: Shared = {}
    keys.set(key, created)

    return created
  }

  const sources = (from: MainStoreFrom | readonly MainStoreFrom[] | undefined) =>
    [from ?? []].flat().map((item) => source(state, settings, item))

  const remove = (key: string, from: MainStoreFrom | readonly MainStoreFrom[] | undefined) => {
    // The old copies go too, or the next read would import one again.
    sources(from).forEach((older) => older.remove())

    if (state.get(name, key) !== null) state.delete(name, key)
    state.flush()
    // The stores open on the key read their `initial` again.
    const entry = keys.get(key)

    if (entry) entry.json = null
  }

  return {
    store(key, options) {
      const codec = Schema.toCodecJson(options.schema)
      const legacy = sources(options.from)
      const entry = shared(key)
      const decoded: Decoded<typeof options.initial> = {}

      // The stored JSON, imported once from the newest older home that holds a value this store's schema accepts; the
      // old location keeps its copy for builds that still read it.
      const read = () => {
        const stored = state.get(name, key)

        if (stored !== null) return stored

        // Each home is read once; one whose value the schema rejects holds nothing for this store.
        const found = legacy.reduce<{ readonly value: unknown } | undefined>((match, older) => {
          if (match) return match
          const value = older.read()

          return value !== undefined && Option.isSome(Schema.decodeUnknownOption(codec)(value)) ? { value } : undefined
        }, undefined)

        if (!found) return null
        const json = JSON.stringify(found.value)
        state.set(name, key, json)

        return json
      }

      const current = () => {
        // Null is a known empty key, so only an unread one goes to the database.
        if (entry.json === undefined) entry.json = read()
        const json = entry.json
        const cached = decoded.value

        if (cached && cached.json === json) return cached.current
        const value = json === null ? Option.none() : Schema.decodeUnknownOption(Schema.fromJsonString(codec))(json)
        const next = { json, current: Option.getOrElse(value, () => options.initial) }
        decoded.value = next

        return next.current
      }

      // Keeps a decoded copy of what was stored, so the caller's object never aliases the stored value.
      const write = (value: typeof options.initial) => {
        const encoded = Schema.encodeSync(codec)(value)
        const json = JSON.stringify(encoded)

        state.set(name, key, json)
        state.flush()
        entry.json = json
        decoded.value = { json, current: Schema.decodeSync(codec)(encoded) }
      }

      return {
        get value() {
          return current()
        },
        ready: () => true,
        // The draft is a decoded copy, so mutation cannot touch the cache before the write. Schema readonly fields
        // are type-level only; the decoded JSON's objects and arrays are writable.
        update(mutate) {
          const draft = Schema.decodeSync(codec)(Schema.encodeSync(codec)(current()))
          // SAFETY: the codec above creates a writable copy of the stored JSON, including its nested fields.
          const returned = mutate(draft as Mutable<typeof options.initial>)

          if (returned !== undefined)
            throw new Error("Persisted.update must not return a value. Use set(next) to replace the value.")

          write(draft)
        },
        set: write,
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
