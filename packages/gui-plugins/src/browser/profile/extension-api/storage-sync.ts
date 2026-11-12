import { Schema } from "effect"
import type { Storage } from "@opencode/plugin/gui/main"
import { method, none, optional, type ApiModule, type Emit, type Wire } from "./api"

/** Each extension's items, by key, each as its JSON text. */
const SyncItems = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String))

const Keys = optional(
  Schema.Union([Schema.String, Schema.Array(Schema.String), Schema.Record(Schema.String, Schema.Json)]),
)

/** The items `get` answers for `keys`: all of them, the ones named, or the ones named with defaults for the rest. */
export function pick(
  items: Readonly<Record<string, string>>,
  keys: string | readonly string[] | Readonly<Record<string, Schema.Json>> | null | undefined,
) {
  const read = (key: string) => (key in items ? [[key, JSON.parse(items[key] ?? "null")]] : [])

  if (keys == null) return Object.fromEntries(Object.keys(items).flatMap(read))

  if (Schema.is(Schema.String)(keys) || Array.isArray(keys)) return Object.fromEntries([keys].flat().flatMap(read))

  return Object.fromEntries(
    Object.entries(keys).map(([key, fallback]) => [key, key in items ? JSON.parse(items[key] ?? "null") : fallback]),
  )
}

/**
 * `chrome.storage.sync` for extension pages and workers, which Electron lacks. Items stay on this device in the
 * app's storage, as `local` does; nothing syncs. Content scripts keep Chromium's own `sync`, which still refuses.
 */
export function createStorageSync(input: { storage: Storage; emit: Emit }): ApiModule {
  const store = input.storage.store("extension-sync", { schema: SyncItems, initial: {} })
  const itemsOf = (extension: string) => store.value[extension] ?? {}

  const write = (extension: string, next: Readonly<Record<string, string>>) => {
    const previous = itemsOf(extension)
    store.set({ ...store.value, [extension]: next })
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)])

    const changes = Object.fromEntries(
      [...keys].flatMap((key): [string, Wire][] =>
        previous[key] === next[key]
          ? []
          : [
              [
                key,
                {
                  oldValue: previous[key] === undefined ? undefined : JSON.parse(previous[key]),
                  newValue: next[key] === undefined ? undefined : JSON.parse(next[key]),
                },
              ],
            ],
      ),
    )

    if (Object.keys(changes).length > 0) input.emit("storage.sync.onChanged", [changes], extension)
  }

  return {
    namespaces: [
      {
        path: "storage.sync",
        permissions: ["storage"],
        methods: ["get", "set", "remove", "clear", "getBytesInUse", "getKeys", "setAccessLevel"],
        events: ["onChanged"],
        constants: {
          QUOTA_BYTES: 102_400,
          QUOTA_BYTES_PER_ITEM: 8192,
          MAX_ITEMS: 512,
          MAX_WRITE_OPERATIONS_PER_HOUR: 1800,
          MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
        },
      },
    ],
    methods: {
      "storage.sync.get": method(Schema.Tuple([Keys]), (context, [keys]) => pick(itemsOf(context.extension.id), keys)),
      "storage.sync.getKeys": method(none, (context) => Object.keys(itemsOf(context.extension.id))),
      "storage.sync.set": method(Schema.Tuple([Schema.Record(Schema.String, Schema.Json)]), (context, [items]) =>
        write(context.extension.id, {
          ...itemsOf(context.extension.id),
          ...Object.fromEntries(Object.entries(items).map(([key, value]) => [key, JSON.stringify(value) ?? "null"])),
        }),
      ),
      "storage.sync.remove": method(
        Schema.Tuple([Schema.Union([Schema.String, Schema.Array(Schema.String)])]),
        (context, [keys]) => {
          const removed = new Set([keys].flat())
          write(
            context.extension.id,
            Object.fromEntries(Object.entries(itemsOf(context.extension.id)).filter(([key]) => !removed.has(key))),
          )
        },
      ),
      "storage.sync.clear": method(none, (context) => write(context.extension.id, {})),
      "storage.sync.getBytesInUse": method(Schema.Tuple([Keys]), (context, [keys]) =>
        Object.entries(itemsOf(context.extension.id))
          .filter(([key]) => keys == null || [keys].flat().includes(key))
          .reduce((total, [key, value]) => total + key.length + value.length, 0),
      ),
      "storage.sync.setAccessLevel": method(none, () => undefined),
    },
  }
}
