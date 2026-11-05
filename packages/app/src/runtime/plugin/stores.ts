import {
  batch,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  getOwner,
  on,
  onCleanup,
  untrack,
  type Accessor,
  type Owner,
} from "solid-js"
import { produce, reconcile, type SetStoreFunction } from "solid-js/store"
import { Predicate } from "effect"
import type { Mutable, Persisted, SessionRef } from "@opencode/plugin/gui"
import type { BuiltinStoreFrom } from "@opencode/plugin/gui/builtin"
import { Persist, type persisted } from "@/runtime/persistence/storage"
import type { SessionStateKey } from "@/runtime/server/scope"
import {
  createDeferredStoreState,
  createStoreLoadState,
  selectStoreReady,
  transitionDeferredStore,
  transitionStoreLoad,
  type DeferredStoreEvent,
  type StoreLoadEvent,
  type StoreWrite,
} from "./store-machine"

/** One older key persistence imports a store's value from. */
type CopyFrom = NonNullable<Exclude<Parameters<typeof persisted>[0], string>["copyFrom"]>[number]

const loads = new WeakMap<object, Promise<void>>()

/** The storage key of a plugin's store: the plugin id is its namespace. */
export function storeName(plugin: string, key: string) {
  return `plugin.${plugin}.${key}`
}

/** The key the same store of a built-in had before plugins were renamed from extensions. */
export function renamedStoreName(plugin: string, key: string) {
  return `extension.${plugin}.${key}`
}

/**
 * Imports a built-in's store value once from where it lived before the rename: the same place under
 * `renamedStoreName`. It copies instead of moving, so an older build opened on the same storage still finds the value.
 * Other plugins never stored values there.
 */
export function renamedFrom(target: { readonly storage?: string; readonly key: string }): CopyFrom {
  return { key: target.key, storage: target.storage, pick: (value) => value }
}

/** Where `Storage.store` keeps a plugin's app-wide store, with the older keys it imports. */
export function globalStoreTarget(
  plugin: string,
  key: string,
  from: BuiltinStoreFrom | readonly BuiltinStoreFrom[] | undefined,
  builtin: boolean,
) {
  return {
    ...Persist.global(storeName(plugin, key)),
    copyFrom: [...(builtin ? [renamedFrom(Persist.global(renamedStoreName(plugin, key)))] : []), ...storeImports(from)],
  }
}

/**
 * A store's `from` in the form persistence takes, in order. For a session store, an app key holding every session's
 * state under one field imports only that session's entry.
 */
export function storeImports(
  from: BuiltinStoreFrom | readonly BuiltinStoreFrom[] | undefined,
  session?: SessionStateKey,
): CopyFrom[] {
  return [from ?? []].flat().map((item) => (session && sessionCopy(item, session)) || copySpec(item))
}

function copySpec(from: BuiltinStoreFrom): CopyFrom {
  return Predicate.isString(from) ? { key: from } : from
}

function sessionCopy(from: BuiltinStoreFrom, session: SessionStateKey): CopyFrom | undefined {
  if (Predicate.isString(from) || !from.sessions) return

  const field = from.sessions

  return {
    key: from.key,
    storage: Persist.global(from.key).storage,
    pick: (value) => {
      const sessions = Predicate.isObject(value) ? value[field] : undefined

      return from.pick(Predicate.isObject(sessions) ? sessions[session] : undefined)
    },
  }
}

/**
 * What `Storage.store` returns: a `Persisted` whose `update` and `set` wait for load, then apply in call order. When
 * the storage read fails, the value never loads and writes are dropped.
 */
export function persistedHandle<T extends object>(input: {
  readonly store: T
  /** The persisted store's setter. */
  readonly set: SetStoreFunction<T>
  /** The storage read; undefined when storage answered synchronously. */
  readonly init: Promise<unknown> | undefined
}) {
  const [loadState, setLoadState] = createSignal(createStoreLoadState<T>(input.init !== undefined))
  const settled = input.init && Promise.withResolvers<void>()

  // Runtime-key stores have no setup awaiter, and nothing awaits the load of a store disposed while it loads.
  void settled?.promise.catch(() => undefined)

  const apply = (write: StoreWrite<T>) => {
    if (write.kind === "set") return input.set(reconcile(write.value))
    input.set(
      produce((draft) => {
        // SAFETY: Solid's produce draft is writable recursively; schema readonly fields constrain readers, not drafts.
        const returned = write.mutate(draft as Mutable<T>)

        if (returned !== undefined)
          throw new Error("Persisted.update must not return a value. Use set(next) to replace the value.")
      }),
    )
  }

  const dispatch = (event: StoreLoadEvent<T>) => {
    const next = transitionStoreLoad(untrack(loadState), event)

    setLoadState(next.state)
    next.effects.forEach((effect) => {
      if (effect.type === "reject") {
        if (effect.log) console.error("[plugin storage] Load failed", effect.cause)

        return settled?.reject(effect.cause)
      }

      if (!effect.hydrated) return effect.writes.forEach(apply)

      // Promise.try applies each write now and isolates a throw, which still reports its contract error.
      const applied = effect.writes.map((write) => Promise.try(() => apply(write)))
      applied.forEach(
        (write) => void write.catch((cause: unknown) => console.error("[plugin storage] Queued write failed", cause)),
      )
      void Promise.all(applied).then(
        () => settled?.resolve(),
        (cause: unknown) => settled?.reject(cause),
      )
    })
  }

  // Registered after the store's own hydration on the same read, so queued changes apply over the stored value. One
  // batch: readers see the value only with the queued changes on it.
  void input.init?.then(
    () => batch(() => dispatch({ type: "loaded" })),
    (cause: unknown) => dispatch({ type: "failed", cause }),
  )

  if (getOwner()) onCleanup(() => dispatch({ type: "disposed" }))

  const handle: Persisted<T> = {
    get value() {
      return selectStoreReady(loadState()) ? input.store : undefined
    },
    ready: () => selectStoreReady(loadState()),
    update: (mutate) => dispatch({ type: "write", write: { kind: "update", mutate } }),
    set: (next) => dispatch({ type: "write", write: { kind: "set", value: next } }),
  }

  if (settled) loads.set(handle, settled.promise)

  return handle
}

/**
 * Settles once a handle from `persistedHandle` has loaded and applied the writes that waited; rejects when its storage
 * read failed, it was disposed first, or a waiting write threw (the value still loads then).
 */
export function whenLoaded<T>(handle: Persisted<T>) {
  return loads.get(handle) ?? Promise.resolve()
}

/**
 * A `Persisted` over a store that opens later: `value` is undefined and `ready()` false until `store` returns one, and
 * changes made before then, or while `store` reopens, wait and apply in order. Call it inside an owner, which ends the
 * hand-over.
 */
export function deferredHandle<T>(store: Accessor<Persisted<T> | undefined>): Persisted<T> {
  const machine = { state: createDeferredStoreState<Persisted<T>, T>() }

  const dispatch = (event: DeferredStoreEvent<Persisted<T>, T>) => {
    const next = transitionDeferredStore(machine.state, event)

    machine.state = next.state
    next.effects.forEach((effect) =>
      untrack(() => {
        if (effect.type === "forward") return forward(effect.handle, effect.write)

        // Promise.try isolates a throw, so every write that waited still reaches the store.
        effect.writes.forEach(
          (write) =>
            void Promise.try(() => forward(effect.handle, write)).catch((cause: unknown) =>
              console.error("[plugin storage] Queued write failed", cause),
            ),
        )
      }),
    )
  }

  // Hands changes made while no store was open to the one that opens, which applies them once it has loaded.
  createRenderEffect(() => dispatch({ type: "sync", handle: store() }))

  if (getOwner()) onCleanup(() => dispatch({ type: "disposed" }))

  // A store that opened in this batch takes the waiting writes before this one, ahead of the render effect.
  const write = (value: StoreWrite<T>) => {
    dispatch({ type: "sync", handle: untrack(store) })
    dispatch({ type: "write", write: value })
  }

  return {
    get value() {
      return store()?.value
    },
    ready: () => store()?.ready() ?? false,
    update: (mutate) => write({ kind: "update", mutate }),
    set: (next) => write({ kind: "set", value: next }),
  }
}

function forward<T>(handle: Persisted<T>, write: StoreWrite<T>) {
  if (write.kind === "set") return handle.set(write.value)
  handle.update(write.mutate)
}

/**
 * A store of one session, which needs the session's location: it opens once the location is known, and again in a
 * new directory. The session is one session's ref or `MountedSession`, so it never reads another session's location.
 */
export function locatedHandle<T>(session: SessionRef, open: () => Persisted<T>) {
  const directory = createMemo(() => session.location?.directory)

  // A new directory opens the store again; the store from the old one disposes with the previous run.
  return deferredHandle(createMemo(on(directory, (value) => (value === undefined ? undefined : open()))))
}

/**
 * A declared session store: one handle per session, opened through `locatedHandle`. Call it under an owner: an effect
 * drops the store of a session whose tab closed.
 */
export function createSessionStore<T extends object>(input: {
  readonly open: (session: SessionRef) => Persisted<T>
  readonly owner: Owner | null
  /**
   * The host's sessions. `list` holds the refs of open tabs, which follow their servers' live controllers; the ref a
   * store first opens with, such as a screen's `MountedSession`, reads its own screen's controller. `current` is the
   * routed session. Reactive.
   */
  readonly sessions: { list(): readonly SessionRef[]; current(): SessionRef | undefined }
}) {
  const entries = new Map<string, { readonly handle: Persisted<T>; readonly dispose: () => void }>()
  // Keys a tab has listed while their store was open; only these can close.
  const listed = new Set<string>()

  // Drops the stores of sessions whose tabs closed. The routed session keeps its store, and so does one no tab has
  // listed yet: a deep link or a new session routes and preloads before the titlebar adds its tab.
  createRenderEffect(() => {
    const keys = new Set(input.sessions.list().map((session) => session.key))
    const routed = input.sessions.current()?.key

    untrack(() =>
      entries.forEach((entry, key) => {
        if (keys.has(key)) return void listed.add(key)

        if (key === routed || !listed.has(key)) return
        entry.dispose()
        entries.delete(key)
        listed.delete(key)
      }),
    )
  })

  const create = (session: SessionRef) => {
    // The first ref stands in until the host lists the key, and again if its tab closes before the store drops.
    const current = () => input.sessions.list().find((item) => item.key === session.key) ?? session

    const ref: SessionRef = {
      key: session.key,
      id: session.id,
      get tab() {
        return current().tab
      },
      get server() {
        return current().server
      },
      get pending() {
        return current().pending
      },
      get location() {
        return current().location
      },
    }

    return createRoot((dispose) => ({ handle: locatedHandle(ref, () => input.open(ref)), dispose }), input.owner)
  }

  return {
    get(session: SessionRef) {
      const existing = entries.get(session.key)

      if (existing) return existing.handle
      const created = create(session)
      entries.set(session.key, created)

      // Listed already, it closes with its tab.
      if (untrack(input.sessions.list).some((item) => item.key === session.key)) listed.add(session.key)

      return created.handle
    },
    dispose() {
      entries.forEach((entry) => entry.dispose())
      entries.clear()
      listed.clear()
    },
  }
}
