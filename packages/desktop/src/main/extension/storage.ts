import type { MainStorage } from "@opencode/gui-extensions/sdk/main"
import { Option, Schema } from "effect"
import type { StateStore } from "../storage/state"
import { getStore } from "../storage/store"

/** Each extension's values live in the `state` table under `extension.<id>`, stored as canonical JSON. */
export function createMainStorage(state: StateStore, id: string): MainStorage {
  const name = namespace(id)
  return {
    store(key, options) {
      const codec = Schema.toCodecJson(options.schema)
      const legacy = options.from ? source(state, options.from) : undefined
      const cached: { value?: { current: typeof options.initial } } = {}
      const read = () => {
        const stored = state.get(name, key)
        if (stored !== null) return Schema.decodeUnknownOption(Schema.fromJsonString(codec))(stored)
        const found = legacy?.read()
        if (found === undefined) return Option.none()
        const decoded = Schema.decodeUnknownOption(codec)(found)
        // Imported once; the old location keeps its copy for builds that still read it.
        if (Option.isSome(decoded)) state.set(name, key, JSON.stringify(found))
        return decoded
      }
      return {
        get() {
          cached.value ??= { current: Option.getOrElse(read(), () => options.initial) }
          return cached.value.current
        },
        set(value) {
          state.set(name, key, JSON.stringify(Schema.encodeSync(codec)(value)))
          cached.value = { current: value }
        },
        remove() {
          // The old copy goes too, or the next read would import it again.
          legacy?.remove()
          if (state.get(name, key) !== null) state.delete(name, key)
          cached.value = { current: options.initial }
        },
      }
    },
  }
}

export function namespace(id: string) {
  return `extension.${id}`
}

// `settings:<key>` reads the JSON settings file and `settings:<file>/<key>` another one (e.g. opencode.updater);
// `state:<name>/<key>` reads another state namespace.
function source(state: StateStore, from: string): { read(): unknown; remove(): void } {
  if (from.startsWith("settings:")) {
    const [file, key] = from.slice("settings:".length).split("/", 2)
    const store = () => (key === undefined ? getStore() : getStore(file))
    const entry = key ?? file ?? ""
    return {
      read: () => store().get(entry),
      remove() {
        if (store().get(entry) !== undefined) store().delete(entry)
      },
    }
  }
  if (from.startsWith("state:")) {
    const [name = "", ...rest] = from.slice("state:".length).split("/")
    const key = rest.join("/")
    return {
      read() {
        const value = state.get(name, key)
        if (value === null) return undefined
        return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(value))
      },
      remove() {
        if (state.get(name, key) !== null) state.delete(name, key)
      },
    }
  }
  throw new Error(`Unsupported storage import: ${from}`)
}
