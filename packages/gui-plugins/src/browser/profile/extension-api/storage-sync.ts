import { Option, Schema } from "effect"
import type { Persisted, Storage } from "@opencode/plugin/gui/main"
import { method, none, optional, type ApiModule, type Emit, type Wire } from "./api"

/** One extension's items, by key, each as its JSON text. */
const SyncItems = Schema.Record(Schema.String, Schema.String)

type SyncItems = Readonly<Record<string, string>>

const Keys = optional(
  Schema.Union([Schema.String, Schema.Array(Schema.String), Schema.Record(Schema.String, Schema.Json)]),
)

/** Chrome's limits for `storage.sync`, which an extension reads from the namespace and this enforces as Chrome does. */
export const SYNC_QUOTA = {
  QUOTA_BYTES: 102_400,
  QUOTA_BYTES_PER_ITEM: 8192,
  MAX_ITEMS: 512,
  MAX_WRITE_OPERATIONS_PER_HOUR: 1800,
  MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
} as const

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json))

/** A stored item's value; this module wrote the text, so anything unreadable reads as null. */
function parse(text: string | undefined): Wire {
  return text === undefined ? undefined : Option.getOrElse(decodeJson(text), () => null)
}

/** The items `get` answers for `keys`: all of them, the ones named, or the ones named with defaults for the rest. */
export function pick(
  items: SyncItems,
  keys: string | readonly string[] | Readonly<Record<string, Schema.Json>> | null | undefined,
) {
  const read = (key: string) => (Object.hasOwn(items, key) ? [[key, parse(items[key])]] : [])

  if (keys == null) return Object.fromEntries(Object.keys(items).flatMap(read))

  if (Schema.is(Schema.String)(keys) || Array.isArray(keys)) return Object.fromEntries([keys].flat().flatMap(read))

  return Object.fromEntries(
    Object.entries(keys).map(([key, fallback]) => [key, Object.hasOwn(items, key) ? parse(items[key]) : fallback]),
  )
}

/**
 * Why Chrome would refuse to write `next` over `previous`, as the message its `runtime.lastError` carries; undefined
 * when it fits. Bytes count each key and its JSON text, as Chrome counts them. `changed` are the keys this write sets.
 */
export function syncQuotaError(previous: SyncItems, next: SyncItems, changed: readonly string[]) {
  const bytes = (key: string) => Buffer.byteLength(key) + Buffer.byteLength(next[key] ?? "")

  if (changed.some((key) => bytes(key) > SYNC_QUOTA.QUOTA_BYTES_PER_ITEM)) return "QUOTA_BYTES_PER_ITEM quota exceeded"
  const keys = Object.keys(next)

  // A write that only shrinks what is stored is allowed even over a limit, so an extension can always clean up.
  if (keys.length > SYNC_QUOTA.MAX_ITEMS && keys.length > Object.keys(previous).length) return "MAX_ITEMS quota exceeded"
  const total = keys.reduce((sum, key) => sum + bytes(key), 0)

  return total > SYNC_QUOTA.QUOTA_BYTES ? "QUOTA_BYTES quota exceeded" : undefined
}

/**
 * Whether one more write fits Chrome's per-minute and per-hour limits, given the times of the extension's writes in
 * the last hour (milliseconds, oldest first).
 */
export function syncRateError(writes: readonly number[], now: number) {
  if (writes.filter((time) => now - time < 60_000).length >= SYNC_QUOTA.MAX_WRITE_OPERATIONS_PER_MINUTE)
    return "MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded"

  return writes.length >= SYNC_QUOTA.MAX_WRITE_OPERATIONS_PER_HOUR ? "MAX_WRITE_OPERATIONS_PER_HOUR quota exceeded" : undefined
}

/**
 * `chrome.storage.sync` for extension pages and workers, which Electron lacks. Items stay on this device in the
 * app's storage, one stored key per extension, as `local` does; nothing syncs. Writes keep Chrome's quotas.
 * Content scripts keep Chromium's own `sync`, which still refuses.
 */
export function createStorageSync(input: { storage: Storage; emit: Emit }) {
  const stores = new Map<string, Persisted<SyncItems, SyncItems>>()
  // Each extension's write times in the last hour, for the rate limits.
  const writes = new Map<string, number[]>()

  const storeOf = (extension: string) => {
    const known = stores.get(extension)

    if (known) return known
    const store = input.storage.store(`extension-sync.${extension}`, { schema: SyncItems, initial: {} })
    stores.set(extension, store)

    return store
  }

  const itemsOf = (extension: string) => storeOf(extension).value

  const write = (extension: string, next: SyncItems, changed: readonly string[]) => {
    const previous = itemsOf(extension)
    const now = Date.now()
    const recent = (writes.get(extension) ?? []).filter((time) => now - time < 3_600_000)
    const refused = syncRateError(recent, now) ?? syncQuotaError(previous, next, changed)

    if (refused) throw new Error(refused)
    writes.set(extension, [...recent, now])
    storeOf(extension).set(next)
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)])

    const changes = Object.fromEntries(
      [...keys].flatMap((key): [string, Wire][] =>
        previous[key] === next[key] ? [] : [[key, { oldValue: parse(previous[key]), newValue: parse(next[key]) }]],
      ),
    )

    if (Object.keys(changes).length > 0) input.emit("storage.sync.onChanged", [changes], extension)
  }

  const module: ApiModule = {
    namespaces: [
      {
        path: "storage.sync",
        permissions: ["storage"],
        methods: ["get", "set", "remove", "clear", "getBytesInUse", "getKeys", "setAccessLevel"],
        events: ["onChanged"],
        constants: SYNC_QUOTA,
      },
    ],
    methods: {
      "storage.sync.get": method(Schema.Tuple([Keys]), (context, [keys]) => pick(itemsOf(context.extension.id), keys)),
      "storage.sync.getKeys": method(none, (context) => Object.keys(itemsOf(context.extension.id))),
      "storage.sync.set": method(Schema.Tuple([Schema.Record(Schema.String, Schema.Json)]), (context, [items]) => {
        const added = Object.entries(items).map(([key, value]) => [key, JSON.stringify(value) ?? "null"] as const)
        write(context.extension.id, { ...itemsOf(context.extension.id), ...Object.fromEntries(added) }, Object.keys(items))
      }),
      "storage.sync.remove": method(
        Schema.Tuple([Schema.Union([Schema.String, Schema.Array(Schema.String)])]),
        (context, [keys]) => {
          const removed = new Set([keys].flat())
          write(
            context.extension.id,
            Object.fromEntries(Object.entries(itemsOf(context.extension.id)).filter(([key]) => !removed.has(key))),
            [],
          )
        },
      ),
      "storage.sync.clear": method(none, (context) => write(context.extension.id, {}, [])),
      "storage.sync.getBytesInUse": method(Schema.Tuple([Keys]), (context, [keys]) =>
        Object.entries(itemsOf(context.extension.id))
          .filter(([key]) => keys == null || [keys].flat().includes(key))
          .reduce((total, [key, value]) => total + Buffer.byteLength(key) + Buffer.byteLength(value), 0),
      ),
      "storage.sync.setAccessLevel": method(none, () => undefined),
    },
  }

  return {
    module,
    /** Deletes an extension's items, as when it is removed. */
    remove(extension: string) {
      stores.delete(extension)
      writes.delete(extension)
      input.storage.remove(`extension-sync.${extension}`)
    },
  }
}
