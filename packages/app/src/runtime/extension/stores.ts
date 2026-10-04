import {
  batch,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  on,
  untrack,
  type Accessor,
  type Owner,
} from "solid-js"
import { produce, reconcile, type SetStoreFunction } from "solid-js/store"
import { Predicate } from "effect"
import type { Mutable, Persisted, SessionRef, StoreFrom } from "@opencode/gui-extensions/sdk"
import { Persist, type persisted } from "@/runtime/persistence/storage"
import type { SessionStateKey } from "@/runtime/server/scope"

/** One older key persistence imports a store's value from. */
type CopyFrom = NonNullable<Exclude<Parameters<typeof persisted>[0], string>["copyFrom"]>[number]

const loads = new WeakMap<object, Promise<void>>()

/** The storage key of an extension's store: the extension id is its namespace. */
export function storeName(extension: string, key: string) {
  return `extension.${extension}.${key}`
}

/** Where `Storage.store` keeps an extension's app-wide store, with the older keys it imports. */
export function globalStoreTarget(extension: string, key: string, from: StoreFrom | readonly StoreFrom[] | undefined) {
  return { ...Persist.global(storeName(extension, key)), copyFrom: storeImports(from) }
}

/**
 * A store's `from` in the form persistence takes, in order. For a session store, an app key holding every session's
 * state under one field imports only that session's entry.
 */
export function storeImports(
  from: StoreFrom | readonly StoreFrom[] | undefined,
  session?: SessionStateKey,
): CopyFrom[] {
  return [from ?? []].flat().map((item) => (session && sessionCopy(item, session)) || copySpec(item))
}

function copySpec(from: StoreFrom): CopyFrom {
  return Predicate.isString(from) ? { key: from } : from
}

function sessionCopy(from: StoreFrom, session: SessionStateKey): CopyFrom | undefined {
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
 * What `Storage.store` returns: a `Persisted` whose `update` and `set` wait for load, then apply in call order.
 */
export function persistedHandle<T extends object>(input: {
  readonly store: T
  /** The persisted store's setter. */
  readonly set: SetStoreFunction<T>
  /** The storage read; undefined when storage answered synchronously. */
  readonly init: Promise<unknown> | undefined
}) {
  const [loaded, setLoaded] = createSignal(!input.init)
  const queue: (() => void)[] = []

  const write = (apply: () => void) => {
    if (untrack(loaded)) return apply()

    queue.push(apply)
  }

  // Registered after the store's own hydration on the same read, so queued changes apply over the stored value.
  const load = input.init?.then(() =>
    batch(() => {
      queue.splice(0).forEach((apply) => apply())
      setLoaded(true)
    }),
  )

  // Runtime-key stores have no setup awaiter: a failed queued mutation must still report its contract error.
  void load?.catch((cause: unknown) => console.error("[extension storage] Load or queued write failed", cause))

  const handle: Persisted<T> = {
    get value() {
      return loaded() ? input.store : undefined
    },
    ready: loaded,
    update(mutate) {
      write(() =>
        input.set(
          produce((draft) => {
            // SAFETY: Solid's produce draft is writable recursively; schema readonly fields constrain readers, not drafts.
            const returned = mutate(draft as Mutable<T>)

            if (returned !== undefined)
              throw new Error("Persisted.update must not return a value. Use set(next) to replace the value.")
          }),
        ),
      )
    },
    set(next) {
      write(() => input.set(reconcile(next)))
    },
  }

  if (load) loads.set(handle, load)

  return handle
}

/** Settles once a handle from `persistedHandle` has loaded; rejects when its storage read failed. */
export function whenLoaded<T>(handle: Persisted<T>) {
  return loads.get(handle) ?? Promise.resolve()
}

/**
 * A `Persisted` over a store that opens later: `value` is undefined and `ready()` false until `store` returns one, and
 * changes made before then wait and apply in order. Call it inside an owner, which ends the hand-over.
 */
export function deferredHandle<T>(store: Accessor<Persisted<T> | undefined>): Persisted<T> {
  const queue: ((current: Persisted<T>) => void)[] = []

  // Hands changes made before the store opened to it, which applies them once it has loaded.
  createRenderEffect(() => {
    const current = store()

    if (current && queue.length > 0) untrack(() => queue.splice(0).forEach((apply) => apply(current)))
  })

  return {
    get value() {
      return store()?.value
    },
    ready: () => store()?.ready() ?? false,
    update(mutate) {
      const current = untrack(store)

      if (current) return current.update(mutate)
      queue.push((opened) => opened.update(mutate))
    },
    set(next) {
      const current = untrack(store)

      if (current) return current.set(next)
      queue.push((opened) => opened.set(next))
    },
  }
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
