import { Platform, usePlatform } from "@/runtime/platform/platform"
import { makePersisted, messageSync, type AsyncStorage, type SyncStorage } from "@solid-primitives/storage"
import { checksum } from "@opencode-ai/util/encode"
import { createResource, onCleanup, type Accessor } from "solid-js"
import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import { Option, Schema } from "effect"
import { pathKey } from "@/workspaces/path-key"
import { ScopedKey, ServerScope } from "@/runtime/server/scope"
import { Persistence } from "./schema"

type InitType = Promise<string> | string | null
type PersistedWithReady<T> = [
  Store<T>,
  SetStoreFunction<T>,
  InitType,
  Accessor<boolean> & { promise: undefined | Promise<unknown> },
]

type PersistTarget = {
  draft?: boolean
  sync?: boolean
  storage?: string
  scope?: "window"
  workspaceStorageAliases?: string[]
  previousKey?: string
  key: string
}

const GLOBAL_STORAGE = "opencode.global.dat"
const WINDOW_STORAGE = "opencode.window"
const LOCAL_PREFIX = "opencode."
const fallback = new Map<string, boolean>()

const CACHE_MAX_ENTRIES = 500
const CACHE_MAX_BYTES = 8 * 1024 * 1024

type CacheEntry = { value: string; bytes: number }
const cache = new Map<string, CacheEntry>()
const cacheTotal = { bytes: 0 }

function cacheDelete(key: string) {
  const entry = cache.get(key)
  if (!entry) return
  cacheTotal.bytes -= entry.bytes
  cache.delete(key)
}

function cachePrune() {
  for (;;) {
    if (cache.size <= CACHE_MAX_ENTRIES && cacheTotal.bytes <= CACHE_MAX_BYTES) return
    const oldest = cache.keys().next().value as string | undefined
    if (!oldest) return
    cacheDelete(oldest)
  }
}

function cacheSet(key: string, value: string) {
  const bytes = value.length * 2
  if (bytes > CACHE_MAX_BYTES) {
    cacheDelete(key)
    return
  }

  const entry = cache.get(key)
  if (entry) cacheTotal.bytes -= entry.bytes
  cache.delete(key)
  cache.set(key, { value, bytes })
  cacheTotal.bytes += bytes
  cachePrune()
}

function cacheGet(key: string) {
  const entry = cache.get(key)
  if (!entry) return
  cache.delete(key)
  cache.set(key, entry)
  return entry.value
}

function fallbackDisabled(scope: string) {
  return fallback.get(scope) === true
}

function fallbackSet(scope: string) {
  fallback.set(scope, true)
}

function quota(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "QuotaExceededError") return true
    if (error.name === "NS_ERROR_DOM_QUOTA_REACHED") return true
    if (error.name === "QUOTA_EXCEEDED_ERR") return true
    if (error.code === 22 || error.code === 1014) return true
    return false
  }

  if (!error || typeof error !== "object") return false
  const name = (error as { name?: string }).name
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return true
  if (name && /quota/i.test(name)) return true

  const code = (error as { code?: number }).code
  if (code === 22 || code === 1014) return true

  const message = (error as { message?: string }).message
  if (typeof message !== "string") return false
  if (/quota/i.test(message)) return true
  return false
}

type Evict = { key: string; size: number }

function evict(storage: Storage, keep: string, value: string) {
  const total = storage.length
  const indexes = Array.from({ length: total }, (_, index) => index)
  const items: Evict[] = []

  for (const index of indexes) {
    const name = storage.key(index)
    if (!name) continue
    if (!name.startsWith(LOCAL_PREFIX)) continue
    if (name === keep) continue
    const stored = storage.getItem(name)
    items.push({ key: name, size: stored?.length ?? 0 })
  }

  items.sort((a, b) => b.size - a.size)

  for (const item of items) {
    storage.removeItem(item.key)
    cacheDelete(item.key)

    try {
      storage.setItem(keep, value)
      cacheSet(keep, value)
      return true
    } catch (error) {
      if (!quota(error)) throw error
    }
  }

  return false
}

function write(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value)
    cacheSet(key, value)
    return true
  } catch (error) {
    if (!quota(error)) throw error
  }

  try {
    storage.removeItem(key)
    cacheDelete(key)
    storage.setItem(key, value)
    cacheSet(key, value)
    return true
  } catch (error) {
    if (!quota(error)) throw error
  }

  const ok = evict(storage, key, value)
  return ok
}

function readCurrent(input: { storage: SyncStorage; key: string; normalize: (raw: string) => string | undefined }) {
  const raw = input.storage.getItem(input.key)
  if (raw === null) return
  const next = input.normalize(raw)
  if (next === undefined) {
    input.storage.removeItem(input.key)
    return null
  }
  if (raw !== next) input.storage.setItem(input.key, next)
  return next
}

function relocateStoredValue(input: {
  current: SyncStorage
  sources: { storage: SyncStorage; key?: string }[]
  key: string
  normalize: (raw: string) => string | undefined
}) {
  for (const source of input.sources) {
    const key = source.key ?? input.key
    const raw = source.storage.getItem(key)
    if (raw === null) continue

    const next = input.normalize(raw)
    if (next === undefined) {
      source.storage.removeItem(key)
      continue
    }
    input.current.setItem(input.key, next)
    if (input.current.getItem(input.key) !== next) return null
    source.storage.removeItem(key)
    return next
  }
  return null
}

async function readCurrentAsync(input: {
  storage: AsyncStorage
  key: string
  normalize: (raw: string) => string | undefined
}) {
  const raw = await input.storage.getItem(input.key)
  if (raw === null) return
  const next = input.normalize(raw)
  if (next === undefined) {
    await input.storage.removeItem(input.key).catch(() => undefined)
    return null
  }
  if (raw !== next) await input.storage.setItem(input.key, next)
  return next
}

async function removeAsync(storage: AsyncStorage, key: string) {
  try {
    await storage.removeItem(key)
  } catch {}
}

function toAsyncStorage(storage: SyncStorage | AsyncStorage): AsyncStorage {
  return {
    getItem: async (key) => storage.getItem(key),
    setItem: async (key, value) => storage.setItem(key, value),
    removeItem: async (key) => storage.removeItem(key),
  }
}

async function relocateStoredValueAsync(input: {
  current: AsyncStorage
  sources: { storage: AsyncStorage; key?: string }[]
  key: string
  normalize: (raw: string) => string | undefined
}) {
  for (const source of input.sources) {
    const key = source.key ?? input.key
    const raw = await source.storage.getItem(key)
    if (raw === null) continue

    const next = input.normalize(raw)
    if (next === undefined) {
      await removeAsync(source.storage, key)
      continue
    }
    await input.current.setItem(input.key, next)
    await source.storage.removeItem(key)
    return next
  }
  return null
}

function workspaceStorage(dir: string) {
  const head = (dir.slice(0, 12) || "workspace").replace(/[^a-zA-Z0-9._-]/g, "-")
  const sum = checksum(dir) ?? "0"
  return `opencode.workspace.${head}.${sum}.dat`
}

function draftStorage(draftID: string) {
  const head = (draftID.slice(0, 12) || "draft").replace(/[^a-zA-Z0-9._-]/g, "-")
  const sum = checksum(draftID) ?? "0"
  return `opencode.draft.${head}.${sum}.dat`
}

function windowStorage(windowID: string) {
  const safe = (windowID || "browser").replace(/[^a-zA-Z0-9._-]/g, "-")
  return `${WINDOW_STORAGE}.${safe}.dat`
}

function workspaceStorageAliases(dir: string) {
  const storage = workspaceStorage(pathKey(dir))
  const result = new Set<string>()
  const raw = workspaceStorage(dir)
  if (raw !== storage) result.add(raw)

  const key = pathKey(dir)
  const drive = key.length >= 3 && key[1] === ":" && key[2] === "/"
  if (drive) {
    const backslash = workspaceStorage(key.replaceAll("/", "\\"))
    if (backslash !== storage) result.add(backslash)
  }

  if (result.size === 0) return
  return [...result]
}

function serverWorkspaceTarget(scope: ServerScope, dir: string, key: string): PersistTarget {
  if (scope !== ServerScope.local) return { storage: workspaceStorage(ScopedKey.from(scope, pathKey(dir))), key }
  return { storage: workspaceStorage(pathKey(dir)), workspaceStorageAliases: workspaceStorageAliases(dir), key }
}

function localStorageWithPrefix(prefix: string): SyncStorage {
  const base = `${prefix}:`
  const scope = `prefix:${prefix}`
  const item = (key: string) => base + key
  return {
    getItem: (key) => {
      const name = item(key)
      const cached = cacheGet(name)
      if (fallbackDisabled(scope)) return cached ?? null

      const stored = (() => {
        try {
          return localStorage.getItem(name)
        } catch {
          fallbackSet(scope)
          return null
        }
      })()
      if (stored === null) return cached ?? null
      cacheSet(name, stored)
      return stored
    },
    setItem: (key, value) => {
      const name = item(key)
      if (fallbackDisabled(scope)) return
      try {
        if (write(localStorage, name, value)) return
      } catch {
        fallbackSet(scope)
        return
      }
      fallbackSet(scope)
    },
    removeItem: (key) => {
      const name = item(key)
      cacheDelete(name)
      if (fallbackDisabled(scope)) return
      try {
        localStorage.removeItem(name)
      } catch {
        fallbackSet(scope)
      }
    },
  }
}

function localStorageDirect(): SyncStorage {
  const scope = "direct"
  return {
    getItem: (key) => {
      const cached = cacheGet(key)
      if (fallbackDisabled(scope)) return cached ?? null

      const stored = (() => {
        try {
          return localStorage.getItem(key)
        } catch {
          fallbackSet(scope)
          return null
        }
      })()
      if (stored === null) return cached ?? null
      cacheSet(key, stored)
      return stored
    },
    setItem: (key, value) => {
      if (fallbackDisabled(scope)) return
      try {
        if (write(localStorage, key, value)) return
      } catch {
        fallbackSet(scope)
        return
      }
      fallbackSet(scope)
    },
    removeItem: (key) => {
      cacheDelete(key)
      if (fallbackDisabled(scope)) return
      try {
        localStorage.removeItem(key)
      } catch {
        fallbackSet(scope)
      }
    },
  }
}

const DRAFT_PERSISTED_KEYS = ["prompt", "comments", "file-view", "layout"]

export function draftPersistedKeys() {
  return DRAFT_PERSISTED_KEYS
}

export const PersistTesting = {
  localStorageDirect,
  localStorageWithPrefix,
  resolveTarget,
  windowStorage,
  workspaceStorage,
}

export const Persist = {
  global(key: string): PersistTarget {
    return { storage: GLOBAL_STORAGE, key }
  },
  window(key: string): PersistTarget {
    return { scope: "window", key }
  },
  draft(draftID: string, key: string): PersistTarget {
    return { storage: draftStorage(draftID), key: `draft:${key}` }
  },
  serverGlobal(scope: ServerScope, key: string): PersistTarget {
    if (scope === ServerScope.local) return Persist.global(key)
    return { storage: GLOBAL_STORAGE, key: ScopedKey.from(scope, key) }
  },
  workspace(dir: string, key: string): PersistTarget {
    return serverWorkspaceTarget(ServerScope.local, dir, `workspace:${key}`)
  },
  serverWorkspace(scope: ServerScope, dir: string, key: string): PersistTarget {
    return serverWorkspaceTarget(scope, dir, `workspace:${key}`)
  },
  session(dir: string, session: string, key: string): PersistTarget {
    return serverWorkspaceTarget(ServerScope.local, dir, `session:${session}:${key}`)
  },
  serverSession(scope: ServerScope, dir: string, session: string, key: string): PersistTarget {
    return serverWorkspaceTarget(scope, dir, `session:${session}:${key}`)
  },
  scoped(dir: string, session: string | undefined, key: string): PersistTarget {
    if (session) return Persist.session(dir, session, key)
    return Persist.workspace(dir, key)
  },
  serverScoped(scope: ServerScope, dir: string, session: string | undefined, key: string) {
    if (session) return Persist.serverSession(scope, dir, session, key)
    return Persist.serverWorkspace(scope, dir, key)
  },
  prompt(target: PersistTarget): PersistTarget {
    return { ...target, draft: true }
  },
}

function resolveTarget(target: PersistTarget, platform: Platform): PersistTarget {
  if (target.scope !== "window") return target
  const windowID = platform.platform === "desktop" ? platform.windowID : "browser"
  if (!windowID) throw new Error("Desktop window ID is required for window-scoped storage")
  return {
    ...target,
    storage: windowStorage(windowID),
  }
}

export function removePersisted(
  target: { draft?: boolean; storage?: string; workspaceStorageAliases?: string[]; key: string },
  platform?: Platform,
) {
  if (target.draft && platform?.draftStore) {
    void platform.draftStore.removeItem(`${target.storage ?? "default"}:${target.key}`)
  }
  const isDesktop = platform?.platform === "desktop" && !!platform.storage

  if (isDesktop) {
    void platform.storage?.(target.storage)?.removeItem(target.key)
    for (const storage of target.workspaceStorageAliases ?? []) {
      void platform.storage?.(storage)?.removeItem(target.key)
    }
    return
  }

  if (!target.storage) {
    localStorageDirect().removeItem(target.key)
    return
  }

  localStorageWithPrefix(target.storage).removeItem(target.key)
  for (const storage of target.workspaceStorageAliases ?? []) {
    localStorageWithPrefix(storage).removeItem(target.key)
  }
}

export function persisted<S extends Schema.ConstraintCodec<object, unknown>>(
  target: string | PersistTarget,
  schema: S | Persistence.Migrated<S>,
  initial: NoInfer<S["Type"]>,
  platformOverride?: Platform,
): PersistedWithReady<S["Type"]> {
  const platform = platformOverride ?? usePlatform()
  const config = resolveTarget(typeof target === "string" ? { key: target } : target, platform)

  const initialized = Persistence.withInitial(schema, initial)
  const json = Schema.fromJsonString(initialized)
  const decode = Schema.decodeUnknownOption(json)
  const serialize = Schema.encodeSync(json)
  const normalize = (raw: string) => {
    const value = decode(raw)
    if (Option.isSome(value)) return serialize(value.value)
  }
  const store = createStore<S["Type"]>(Schema.decodeUnknownSync(Schema.toType(initialized))(initial))
  const isDesktop = platform.platform === "desktop" && !!platform.storage
  const draft = config.draft ? platform.draftStore : undefined

  const currentStorage = (() => {
    if (draft) {
      const prefix = `${config.storage ?? "default"}:`
      return {
        getItem: (key: string) => draft.getItem(prefix + key),
        setItem: (key: string, value: string) => draft.setItem(prefix + key, value),
        removeItem: (key: string) => draft.removeItem(prefix + key),
      } satisfies AsyncStorage
    }
    if (isDesktop) return platform.storage?.(config.storage)
    if (!config.storage) return localStorageDirect()
    return localStorageWithPrefix(config.storage)
  })()

  const workspaceAliases = config.workspaceStorageAliases ?? []

  const storage = (() => {
    if (!isDesktop && !draft) {
      const current = currentStorage as SyncStorage
      const sources = [
        ...workspaceAliases.map((storage) => ({ storage: localStorageWithPrefix(storage) })),
        ...(config.previousKey ? [{ storage: localStorageDirect(), key: config.previousKey }] : []),
      ]

      const api: SyncStorage = {
        getItem: (key) => {
          const value = readCurrent({ storage: current, key, normalize })
          if (value !== undefined) return value
          return relocateStoredValue({
            current,
            sources,
            key,
            normalize,
          })
        },
        setItem: (key, value) => {
          current.setItem(key, value)
        },
        removeItem: (key) => {
          current.removeItem(key)
        },
      }

      return api
    }

    const current = currentStorage as AsyncStorage
    const previousDraftStorage = draft
      ? isDesktop
        ? platform.storage?.(config.storage)
        : config.storage
          ? localStorageWithPrefix(config.storage)
          : localStorageDirect()
      : undefined
    const previousStorage = config.previousKey ? (isDesktop ? platform.storage?.() : localStorageDirect()) : undefined
    const relocationSources = [
      previousDraftStorage ? { storage: previousDraftStorage } : undefined,
      ...workspaceAliases.map((name) => ({
        storage: isDesktop ? platform.storage?.(name) : localStorageWithPrefix(name),
      })),
      previousStorage && config.previousKey ? { storage: previousStorage, key: config.previousKey } : undefined,
    ]
      .filter((source): source is { storage: SyncStorage | AsyncStorage; key?: string } => !!source?.storage)
      .map((source) => ({ ...source, storage: toAsyncStorage(source.storage) }))
    let draftLatest: string | undefined

    const api: AsyncStorage = {
      getItem: async (key) => {
        const value = await readCurrentAsync({ storage: current, key, normalize })
        if (value !== undefined) return value
        const relocated = await relocateStoredValueAsync({
          current,
          sources: relocationSources,
          key,
          normalize,
        })
        if (draftLatest === undefined) {
          if (draft && relocated !== null) return (await current.getItem(key)) ?? relocated
          return relocated
        }
        await current.setItem(key, draftLatest)
        return draftLatest
      },
      setItem: async (key, value) => {
        if (draft) draftLatest = value
        await current.setItem(key, value)
      },
      removeItem: async (key) => {
        await current.removeItem(key)
      },
    }

    return api
  })()

  const channel =
    config.sync && typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(`opencode.persist:${config.storage ?? "default"}:${config.key}`)
      : undefined
  if (channel) onCleanup(() => channel.close())

  const [state, setState, init] = makePersisted<S["Type"], typeof store>(store, {
    name: config.key,
    storage,
    serialize,
    deserialize: Schema.decodeUnknownSync(json),
    sync: channel ? messageSync(channel) : undefined,
  })

  const isAsync = init instanceof Promise
  const [ready] = createResource(
    () => init,
    async (initValue) => {
      if (initValue instanceof Promise) await initValue
      return true
    },
    { initialValue: !isAsync },
  )

  return [
    state,
    setState,
    init,
    Object.assign(() => (ready.loading ? false : ready.latest === true), {
      promise: init instanceof Promise ? init : undefined,
    }),
  ]
}
