import { Platform, usePlatform } from "@/runtime/platform/platform"
import { messageSync, type AsyncStorage, type SyncStorage } from "@solid-primitives/storage"
import { checksum } from "@opencode/util/encode"
import { createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import { Option, Predicate, Schema } from "effect"
import { pathKey } from "@/workspaces/path-key"
import { ScopedKey, ServerScope } from "@/runtime/server/scope"
import { persistStore } from "./persist"
import { canWriteBackHydration } from "./persist-machine"
import { Persistence } from "./schema"
import {
  canEvict,
  INITIAL_LOCAL_STORAGE_STATE,
  isStorageNoticePending,
  transitionLocalStorage,
  type LocalStorageEvent,
} from "./storage-machine"

type InitType = Promise<string | null> | string | null

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
  /**
   * Imports an older key once, from this storage (or `storage` when given) or else the default storage
   * (e.g. `settings.v3`). With pick, only that part is copied and the source stays. The first source that holds a
   * value wins.
   */
  copyFrom?: readonly CopyFrom[]
  key: string
}

// SAFETY: an older stored value is JSON with no schema of its own; the store decodes what a pick returns.
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- see SAFETY above
type PickPart = (value: unknown) => unknown

type CopyFrom = { key: string; storage?: string; pick?: PickPart }

const GLOBAL_STORAGE = "opencode.global.dat"

const WINDOW_STORAGE = "opencode.window"

const LOCAL_PREFIX = "opencode."

const [localStorageState, setLocalStorageState] = createSignal(INITIAL_LOCAL_STORAGE_STATE)

function dispatchLocalStorage(event: LocalStorageEvent) {
  setLocalStorageState((state) => transitionLocalStorage(state, event))
}

/** True once a `localStorage` write failed and the user has not been told yet. */
export function localStorageNoticePending() {
  return isStorageNoticePending(localStorageState())
}

export function acknowledgeLocalStorageNotice() {
  dispatchLocalStorage({ type: "notice.shown" })
}

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
    const oldest = cache.keys().next()

    if (oldest.done || !oldest.value) return
    cacheDelete(oldest.value)
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

// SAFETY: a thrown storage error has no schema; only `name`, `code` and `message` are read, each behind a guard.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- see SAFETY above
function quota(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "QuotaExceededError") return true

    if (error.name === "NS_ERROR_DOM_QUOTA_REACHED") return true

    if (error.name === "QUOTA_EXCEEDED_ERR") return true

    if (error.code === 22 || error.code === 1014) return true

    return false
  }

  const name = Predicate.hasProperty(error, "name") && Predicate.isString(error.name) ? error.name : undefined

  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return true

  if (name && /quota/i.test(name)) return true

  const code = Predicate.hasProperty(error, "code") ? error.code : undefined

  if (code === 22 || code === 1014) return true

  const message =
    Predicate.hasProperty(error, "message") && Predicate.isString(error.message) ? error.message : undefined

  return !!message && /quota/i.test(message)
}

/** Writes one `localStorage` value; returns `false` when it could not be stored. */
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
    cacheSet(key, value)

    return true
  } catch (error) {
    if (!quota(error) || !canEvict(untrack(localStorageState), Date.now())) {
      dispatchLocalStorage({ type: "write.failed" })

      return false
    }
  }

  if (evict(localStorage, key, value)) {
    dispatchLocalStorage({ type: "eviction.succeeded" })

    return true
  }

  dispatchLocalStorage({ type: "eviction.failed", now: Date.now() })

  return false
}

/**
 * Removes the key's own old value, then other opencode values largest first, until `value` fits. When
 * nothing makes room, every removed value is put back so a failed write loses no saved state.
 */
function evict(storage: Storage, keep: string, value: string) {
  const items = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((name): name is string => name !== null && (name === keep || name.startsWith(LOCAL_PREFIX)))
    .flatMap((name) => {
      const stored = storage.getItem(name)

      return stored === null ? [] : [{ key: name, value: stored }]
    })
    .sort((a, b) => Number(b.key === keep) - Number(a.key === keep) || b.value.length - a.value.length)

  const removed: typeof items = []

  for (const item of items) {
    storage.removeItem(item.key)
    removed.push(item)

    try {
      storage.setItem(keep, value)
      removed.forEach((entry) => cacheDelete(entry.key))
      cacheSet(keep, value)

      return true
    } catch (error) {
      if (!quota(error)) break
    }
  }

  removed.forEach((entry) => {
    try {
      storage.setItem(entry.key, entry.value)
    } catch {}
  })

  return false
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

type RelocationSource<S> = { storage: S; key?: string; pick?: PickPart }

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

/** Applies a source's pick to its raw JSON; the picked part is re-encoded for the target schema. */
function pickRaw(raw: string | null, pick: PickPart | undefined) {
  if (raw === null || !pick) return raw
  const value = decodeJson(raw)

  if (Option.isNone(value)) return null
  const picked = pick(value.value)

  return picked === undefined ? null : JSON.stringify(picked)
}

function relocateStoredValue(input: {
  current: LocalStorageView
  sources: RelocationSource<SyncStorage>[]
  key: string
  normalize: (raw: string) => string | undefined
}) {
  for (const source of input.sources) {
    const key = source.key ?? input.key
    const raw = pickRaw(source.storage.getItem(key), source.pick)

    if (raw === null) continue

    const next = input.normalize(raw)

    if (next === undefined) {
      if (!source.pick) source.storage.removeItem(key)
      continue
    }

    // When the value cannot be stored here, the source keeps it for the next load.
    if (input.current.setItem(input.key, next) && !source.pick) source.storage.removeItem(key)

    return next
  }

  return null
}

/** `canCommit` turns false once the store saved an edit, so a late load never writes over it. */
async function readCurrentAsync(input: {
  storage: AsyncStorage
  key: string
  normalize: (raw: string) => string | undefined
  canCommit: () => boolean
}) {
  const raw = await input.storage.getItem(input.key)

  if (raw === null) return
  const next = input.normalize(raw)

  if (next === undefined) {
    if (input.canCommit()) await input.storage.removeItem(input.key).catch(() => undefined)

    return null
  }

  if (raw !== next && input.canCommit()) await input.storage.setItem(input.key, next)

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
  sources: RelocationSource<AsyncStorage>[]
  key: string
  normalize: (raw: string) => string | undefined
  canCommit: () => boolean
}) {
  for (const source of input.sources) {
    const key = source.key ?? input.key
    const raw = pickRaw(await source.storage.getItem(key), source.pick)

    if (raw === null) continue

    const next = input.normalize(raw)

    if (next === undefined) {
      if (!source.pick) await removeAsync(source.storage, key)
      continue
    }

    if (input.canCommit()) await input.current.setItem(input.key, next)

    if (!source.pick) await source.storage.removeItem(key)

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

/** A `localStorage` view whose `setItem` reports whether the value was stored. */
type LocalStorageView = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => boolean
  removeItem: (key: string) => void
}

// A failed write never stops later reads, writes or removals: each call tries storage again, and the
// cache only answers a read that storage cannot.
function localStorageView(prefix?: string): LocalStorageView {
  const item = (key: string) => (prefix ? `${prefix}:${key}` : key)

  return {
    getItem: (key) => {
      const name = item(key)

      const stored = (() => {
        try {
          return localStorage.getItem(name)
        } catch {
          return null
        }
      })()

      if (stored === null) return cacheGet(name) ?? null
      cacheSet(name, stored)

      return stored
    },
    setItem: (key, value) => write(item(key), value),
    removeItem: (key) => {
      const name = item(key)
      cacheDelete(name)

      try {
        localStorage.removeItem(name)
      } catch {}
    },
  }
}

const DRAFT_PERSISTED_KEYS = ["prompt", "comments", "file-view", "layout"]

export function draftPersistedKeys() {
  return DRAFT_PERSISTED_KEYS
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

/**
 * Deletes a stored value, so the next read gets the initial value. The older keys `copyFrom` names never import
 * again: a whole-value source is deleted from every storage the import reads, and a picked source, which other owners
 * share, stays while the value becomes `null`, which every store schema reads as its initial value without importing.
 */
export function removePersisted(
  target: Pick<PersistTarget, "draft" | "storage" | "workspaceStorageAliases" | "copyFrom" | "key">,
  platform?: Platform,
) {
  if (target.draft && platform?.draftStore) {
    void platform.draftStore.removeItem(`${target.storage ?? "default"}:${target.key}`)
  }

  const desktop = platform?.platform === "desktop" ? platform.storage : undefined

  const open = (name: string | undefined): SyncStorage | AsyncStorage | undefined => {
    if (desktop) return desktop(name)

    return localStorageView(name)
  }

  const copies = target.copyFrom ?? []

  if (copies.some((copy) => copy.pick)) void open(target.storage)?.setItem(target.key, "null")
  else void open(target.storage)?.removeItem(target.key)
  target.workspaceStorageAliases?.forEach((name) => void open(name)?.removeItem(target.key))
  copies.forEach((copy) => {
    if (copy.pick) return
    void open(copy.storage ?? target.storage)?.removeItem(copy.key)

    if (target.storage) void open(undefined)?.removeItem(copy.key)
  })
}

export function persisted<S extends Schema.ConstraintCodec<object, unknown>>(
  target: string | PersistTarget,
  schema: S | Persistence.Migrated<S>,
  initial: NoInfer<S["Type"]>,
  platformOverride?: Platform,
): PersistedWithReady<S["Type"]> {
  const platform = platformOverride ?? usePlatform()
  const config = resolveTarget(Predicate.isString(target) ? { key: target } : target, platform)

  const initialized = Persistence.withInitial(schema, initial)
  const json = Schema.fromJsonString(initialized)
  const decode = Schema.decodeUnknownOption(json)
  const encode = Schema.encodeSync(initialized)
  const serialize = Schema.encodeSync(json)

  const normalize = (raw: string) => {
    const value = decode(raw)

    if (Option.isSome(value)) return serialize(value.value)
  }

  const store = createStore<S["Type"]>(Schema.decodeUnknownSync(Schema.toType(initialized))(initial))
  const isDesktop = platform.platform === "desktop" && !!platform.storage
  const draft = config.draft ? platform.draftStore : undefined
  const prefix = `${config.storage ?? "default"}:`
  // Only read after the first await of an async load, when `persist` below exists.
  const canCommit = () => canWriteBackHydration(persist.state())

  const currentStorage = (() => {
    if (draft) {
      return {
        getItem: (key: string) => draft.getItem(prefix + key),
        setItem: (key: string, value: string) => draft.setItem(prefix + key, value),
        removeItem: (key: string) => draft.removeItem(prefix + key),
      } satisfies AsyncStorage
    }

    if (isDesktop) return platform.storage?.(config.storage)

    return localStorageView(config.storage)
  })()

  const workspaceAliases = config.workspaceStorageAliases ?? []

  const storage = (() => {
    if (!isDesktop && !draft) {
      // SAFETY: without desktop storage or a draft store, `currentStorage` is one of the synchronous localStorage views.
      const current = currentStorage as LocalStorageView

      const sources: RelocationSource<SyncStorage>[] = [
        ...workspaceAliases.map((storage) => ({ storage: localStorageView(storage) })),
        ...(config.previousKey ? [{ storage: localStorageView(), key: config.previousKey }] : []),
        ...(config.copyFrom ?? []).flatMap((copy) => [
          { storage: copy.storage ? localStorageView(copy.storage) : current, key: copy.key, pick: copy.pick },
          ...(config.storage ? [{ storage: localStorageView(), key: copy.key, pick: copy.pick }] : []),
        ]),
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
        setItem: (key, value) => current.setItem(key, value),
        removeItem: (key) => {
          current.removeItem(key)
        },
      }

      return api
    }

    // SAFETY: with desktop storage or a draft store, `currentStorage` is that asynchronous storage.
    const current = currentStorage as AsyncStorage

    const previousDraftStorage = draft
      ? isDesktop
        ? platform.storage?.(config.storage)
        : localStorageView(config.storage)
      : undefined

    const previousStorage = config.previousKey ? (isDesktop ? platform.storage?.() : localStorageView()) : undefined

    const relocationSources = [
      previousDraftStorage ? { storage: previousDraftStorage } : undefined,
      ...workspaceAliases.map((name) => ({
        storage: isDesktop ? platform.storage?.(name) : localStorageView(name),
      })),
      previousStorage && config.previousKey ? { storage: previousStorage, key: config.previousKey } : undefined,
      ...(config.copyFrom ?? []).flatMap((copy) => [
        {
          storage: copy.storage
            ? isDesktop
              ? platform.storage?.(copy.storage)
              : localStorageView(copy.storage)
            : current,
          key: copy.key,
          pick: copy.pick,
        },
        config.storage
          ? { storage: isDesktop ? platform.storage?.() : localStorageView(), key: copy.key, pick: copy.pick }
          : undefined,
      ]),
    ].flatMap((source): RelocationSource<AsyncStorage>[] =>
      source?.storage ? [{ ...source, storage: toAsyncStorage(source.storage) }] : [],
    )

    const api: AsyncStorage = {
      getItem: async (key) => {
        const value = await readCurrentAsync({ storage: current, key, normalize, canCommit })

        if (value !== undefined) return value

        const relocated = await relocateStoredValueAsync({
          current,
          sources: relocationSources,
          key,
          normalize,
          canCommit,
        })

        if (draft && relocated !== null) return (await current.getItem(key)) ?? relocated

        return relocated
      },
      setItem: async (key, value) => {
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

  const persist = persistStore({
    store: store[0],
    setStore: store[1],
    name: config.key,
    storage,
    serialize,
    deserialize: Schema.decodeUnknownSync(json),
    sync: channel ? messageSync(channel) : undefined,
    // Drafts take the encoded document itself so large text is externalized without the store
    // re-parsing the serialized form on every save.
    write: draft
      ? // A failed chunk upload is retried by the next save; see drafts.ts.
        (value) => draft.setDocument(prefix + config.key, encode(value))
      : undefined,
  })

  return [
    store[0],
    persist.setStore,
    persist.init,
    Object.assign(persist.ready, { promise: persist.init instanceof Promise ? persist.init : undefined }),
  ]
}
