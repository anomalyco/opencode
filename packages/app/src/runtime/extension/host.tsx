import {
  batch,
  catchError,
  createContext,
  createMemo,
  createRenderEffect,
  createResource,
  createRoot,
  createSignal,
  ErrorBoundary,
  getOwner,
  on,
  onCleanup,
  onMount,
  runWithOwner,
  untrack,
  useContext,
  type Accessor,
  type Owner,
  type ParentProps,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Predicate } from "effect"
import { resolveTemplate } from "@solid-primitives/i18n"
import { useDialog } from "@opencode/ui/context/dialog"
import { pluralCategory } from "@opencode/ui/context/i18n"
import {
  ExtensionContext,
  LifetimeContext,
  LinkHandler,
  Live,
  type BaseContext,
  type Catalog,
  type Cleanup,
  type Context,
  type Contract,
  type Definition,
  type Dialogs,
  type Links,
  type Messages,
  type Persisted,
  type Registry,
  type Ipc,
  type IpcClient,
  type IpcRef,
  type IpcSpec,
  type SessionRef,
  type SetupContext,
  type Token,
} from "@opencode/gui-extensions/sdk"
import { useLanguage } from "@/runtime/i18n/language"
import { createSessionStore, whenLoaded } from "./stores"

type Entry = { key: string; registry: string; extension: string; value: Accessor<unknown> }

export type Item<T> = { readonly key: string; readonly extension: string; readonly value: T }

/** The context the host builds: every `Setup<D>` of the definition receives it, and contributions read it as `Context`. */
type InstanceContext = SetupContext<Definition> & Context

type Instance = {
  definition: Definition
  context: InstanceContext
  dispose: () => void
  /** Opens the declared stores. Settles once the global stores have loaded. */
  prepare(): Promise<readonly void[]>
  /** Starts loading the declared session stores for a mounted session. */
  preload(session: SessionRef): void
}

/** The APIs a window context exposes as properties. */
type HostApis = Omit<Context, keyof BaseContext | "signal" | "provide">

/**
 * Creates one HostApi for an extension instance, on the instance's first read of it. `register` withdraws what it is
 * given with the caller's owner, else with the extension.
 */
type HostApiFactory<T> = (
  extension: string,
  owner: Owner | null,
  context: Context,
  register: (fn: Cleanup) => Cleanup,
) => T

/** The HostApis a window provides, by context property. The host itself provides `links` and `dialogs`. */
export type HostApiFactories = {
  readonly [K in Exclude<keyof HostApis, "links" | "dialogs">]: HostApiFactory<HostApis[K]>
}

export type ExtensionStatus = "loading" | "active" | "failed" | "disabled" | "blocked"

/** The last error an extension raised: in its setup or an effect, or while one of its contributions rendered. */
export type ExtensionFailure = { readonly phase: "setup" | "render"; readonly error: string }

type Absent = Exclude<Live<never>, { readonly status: "active" }>

/** A provider as the gate and `requires` see it: its generation while active, else why it is absent. */
type Provider = Absent | { readonly status: "active"; readonly generation: number }

type HostState = {
  entries: Record<string, Entry[] | undefined>
  contracts: Record<string, number | undefined>
  status: Record<string, ExtensionStatus | undefined>
  failures: Record<string, ExtensionFailure | undefined>
}

type Stores = Record<string, Persisted<object> | ((session: SessionRef) => Persisted<object>)>

const pending: Absent = { status: "pending" }

const inactive = {
  disabled: { status: "inactive", reason: "disabled" },
  failed: { status: "inactive", reason: "failed" },
  blocked: { status: "inactive", reason: "blocked" },
  restarting: { status: "inactive", reason: "restarting" },
} as const satisfies Record<string, Absent>

const HostContext = createContext<ReturnType<typeof createHost>>()

export function useExtensionHost() {
  const host = useContext(HostContext)

  if (!host) throw new Error("Extension host is unavailable")

  return host
}

type HostInput = {
  definitions: readonly Definition[]
  disabled: Accessor<ReadonlySet<string> | undefined>
  apis: HostApiFactories
  /**
   * Runs `run` once the app interface has mounted, behind the HostApis writes made before it, or now when it has.
   * Returns a cancel for a run that still waits.
   */
  whenMounted: (run: () => void) => () => void
  /** The renderer client of an Ipc while it is available; omitted where there is no main process. */
  ipc?: (token: Ipc) => IpcClient<IpcSpec> | undefined
  /** How many times an Ipc became available. Reactive. */
  generation?: (token: Ipc) => number
  /** An extension's main entry failed. Reactive. */
  failed?: (id: string) => boolean
}

export function ExtensionHostProvider(props: ParentProps<HostInput>) {
  const host = createHost(props)

  return <HostContext.Provider value={host}>{props.children}</HostContext.Provider>
}

function createHost(input: HostInput) {
  const language = useLanguage()
  const owner = getOwner()
  const provided = new Map<string, { live: Live<unknown> & { readonly status: "active" } }>()
  const generations = new Map<string, number>()

  // Entries are indexed by registry and contracts versioned by token, so a change wakes only its own readers.
  const [state, setState] = createStore<HostState>({ entries: {}, contracts: {}, status: {}, failures: {} })

  const instances = new Map<string, Instance>()
  const memos = new Map<string, Accessor<readonly Item<unknown>[]>>()
  const sequence = { value: 0 }
  // An entry that finishes loading after the host is gone must not create a root nothing disposes.
  const lifetime = { disposed: false }
  // The current load of each extension. Deactivating drops it and a reload replaces it, so an older load
  // neither sets up nor reports a failure over its replacement.
  const loads = new Map<string, object>()

  // The extension that provides a token: the one declaring it in `provides`, else the one whose id prefixes it.
  const providers = new Map<string, string | undefined>()

  const providerOf = (id: string) => {
    if (providers.has(id)) return providers.get(id)

    const found =
      input.definitions.find((definition) =>
        Object.values(definition.provides ?? {}).some((token) => token.id === id),
      ) ?? input.definitions.find((definition) => definition.id === id || id.startsWith(`${definition.id}.`))

    providers.set(id, found?.id)

    return found?.id
  }

  // Why a token has no active provider. Main-side providers report through the installed list.
  const absent = (id: string, generation: number, main: boolean): Absent => {
    const extension = providerOf(id)

    if (!extension) return inactive.disabled

    if (main ? input.disabled()?.has(extension) : state.status[extension] === "disabled") return inactive.disabled

    if (main ? input.failed?.(extension) : state.status[extension] === "failed") return inactive.failed

    // A blocked provider cannot offer its own contracts either, so hard-dependency chains settle as unavailable.
    if (!main && state.status[extension] === "blocked") return inactive.blocked

    // A renderer provider that is up but does not provide the token (e.g. on this platform) is not coming.
    if (!main && state.status[extension] === "active") return inactive.disabled

    return generation > 0 ? inactive.restarting : pending
  }

  const contractLive = (token: Contract<unknown>): Live<unknown> => {
    void state.contracts[token.id]

    return provided.get(token.id)?.live ?? absent(token.id, generations.get(token.id) ?? 0, false)
  }

  // Full Ipc tokens by id. A reference (`Ipc.ref`) carries no spec and resolves through the full token once code
  // in this window uses it; until then it is absent, as pending as its provider allows.
  const [known, setKnown] = createSignal<ReadonlyMap<string, Ipc>>(new Map())

  const learn = (token: Token) => {
    if (token.kind !== "ipc" || !token.spec || untrack(known).has(token.id)) return

    setKnown((map) => new Map(map).set(token.id, token))
  }

  const resolve = (token: Ipc | IpcRef) => (token.spec ? token : known().get(token.id))

  // One object per Ipc generation, so reading a provider allocates nothing while it is unchanged.
  const actives = new Map<string, Provider & { readonly status: "active" }>()

  const providerState = (token: Token): Provider => {
    if (token.kind === "contract") return contractLive(token)

    if (!input.ipc) return inactive.disabled

    const full = resolve(token)

    if (!full || !input.ipc(full)) return absent(token.id, full ? (input.generation?.(full) ?? 0) : 0, true)

    const generation = input.generation?.(full) ?? 1
    const cached = actives.get(token.id)

    if (cached?.generation === generation) return cached

    const active = { status: "active", generation } as const

    actives.set(token.id, active)

    return active
  }

  const satisfied = (definition: Definition) =>
    Object.values(definition.requires ?? {}).every((token) => untrack(() => providerState(token)).status === "active")

  // Reuses each item object while its value is unchanged so keyed renders do not remount.
  const createItems = (id: string) => {
    const cache = new Map<string, Item<unknown>>()

    const created = runWithOwner(owner, () =>
      createMemo(() => {
        const next = (state.entries[id] ?? []).flatMap((entry) => {
          const value = entry.value()

          if (value === undefined) return []

          const previous = cache.get(entry.key)

          if (previous?.value === value) return [previous]

          const item = { key: entry.key, extension: entry.extension, value }

          cache.set(entry.key, item)

          return [item]
        })

        if (cache.size > next.length) {
          const live = new Set(next.map((item) => item.key))

          cache.forEach((_, key) => {
            if (!live.has(key)) cache.delete(key)
          })
        }

        return next
      }),
    )

    const memo = created ?? (() => [])

    memos.set(id, memo)

    return memo
  }

  const items = <T,>(registry: Registry<T>) => {
    const memo = memos.get(registry.id) ?? createItems(registry.id)

    // SAFETY: only `add` stores entries, under the id of the typed registry it was given, so this registry's items
    // are T.
    return memo() as readonly Item<T>[]
  }

  const list = <T,>(registry: Registry<T>) => items(registry).map((item) => item.value)

  const links: Links = {
    open(link) {
      const handler = untrack(() => list(LinkHandler))
        .filter((item) => item.match(link))
        .reduce<LinkHandler | undefined>(
          (best, item) => (!best || (item.priority ?? 0) > (best.priority ?? 0) ? item : best),
          undefined,
        )

      if (!handler) return false

      handler.open(link)

      return true
    },
  }

  const dialog = useDialog()

  const factories = {
    ...input.apis,
    links: () => links,
    // Bound to the instance that asked, so an older async call after a disable or reload opens and closes nothing.
    dialogs: (extension, _, context, register): Dialogs => ({
      open(render, options) {
        const id = `extension:${extension}:${sequence.value++}`
        const waiting = { cancel: () => {} }
        // This open alone: once it aborts, a deferred open neither mounts nor replaces another dialog.
        const opening = new AbortController()

        // Each handle names its own dialog, so it never closes one another extension or instance opened. Closing a
        // dialog that still waits for the app interface, or for its deferred open, cancels it.
        const close = () => {
          opening.abort()
          waiting.cancel()
          dialog.close(id)
        }

        const handle = { close }

        if (context.signal.aborted) return handle

        // Closes this dialog, not whichever is on top, when the extension or the scope that opened it goes away.
        const release = register(close)

        // A dialog opened before the app interface mounts, as during setup, shows after its first render: never behind
        // the startup screen, and never before a route that focuses itself as it mounts.
        waiting.cancel = input.whenMounted(
          () =>
            void dialog[options?.replace ? "show" : "push"](
              () => {
                // The dialog's root disposes when it closes or another dialog replaces it.
                onCleanup(() => void release())

                return (
                  <ErrorBoundary
                    fallback={(error) => {
                      onMount(() => {
                        dialog.close(id)
                        fail(extension, error, "render")
                      })

                      return null
                    }}
                  >
                    <ExtensionContext.Provider value={context}>
                      {untrack(() => render(handle))}
                    </ExtensionContext.Provider>
                  </ErrorBoundary>
                )
              },
              undefined,
              id,
              // The stack mounts in a later transition. Its handle, its owner or the extension ending before then keeps
              // it closed.
              AbortSignal.any([opening.signal, context.signal]),
            ),
        )

        return handle
      },
      active: () => !!dialog.active,
    }),
  } satisfies { readonly [K in keyof HostApis]: HostApiFactory<HostApis[K]> }

  const activate = async (definition: Definition) => {
    const load = definition.renderer

    // A disabled extension, e.g. one reloaded from settings, stays disabled: marking it loading would make the
    // enable watcher skip it later. Before the list loads nothing activates; the watcher starts each entry then.
    if (!load || input.disabled()?.has(definition.id) !== false) return

    const unavailable = Object.values(definition.requires ?? {}).some((token) => {
      const provider = untrack(() => providerState(token))

      return blocked(provider)
    })

    setState("status", definition.id, unavailable ? "blocked" : "loading")

    // Waits for its hard contracts; the requirement watcher starts it once they are active.
    if (!satisfied(definition)) return

    const attempt = {}
    const current = () => loads.get(definition.id) === attempt

    loads.set(definition.id, attempt)

    // The current language's catalog loads with the entry, so the first render is already translated.
    const [module, messages] = await Promise.all([
      load().catch((cause: unknown) => {
        if (current()) fail(definition.id, cause)

        return undefined
      }),
      loadMessages(definition.i18n, untrack(language.locale)),
    ])

    if (!current()) return

    loads.delete(definition.id)

    if (!module || lifetime.disposed) return

    // Disabling mid-load deactivates, which drops this load before it gets here.
    if (instances.has(definition.id)) return

    runWithOwner(owner, () =>
      createRoot((dispose) => {
        const root = getOwner()
        const instance = createInstance(definition, dispose, root, messages)

        instances.set(definition.id, instance)

        // Setup and every scope under it read the extension's context, e.g. `createKeyed` with a token.
        if (root) root.context = { ...root.context, [ExtensionContext.id]: instance.context }

        const crash = (cause: unknown) => {
          if (instances.get(definition.id) !== instance) return

          batch(() => {
            deactivate(definition.id)
            fail(definition.id, cause)
          })
        }

        // SAFETY: the host context implements the parameter of every `Setup<D>` of this definition.
        const setup = module.default as (ctx: InstanceContext) => void

        const start = () =>
          void Promise.try(() =>
            // Errors from the extension's own effects, at setup or later, fail the extension and nothing else.
            catchError(
              () =>
                untrack(() => {
                  const returned = setup(instance.context)

                  if (!Predicate.isPromiseLike(returned)) return

                  // Do not await invalid setup, but consume its eventual rejection after the instance is aborted.
                  void Promise.resolve(returned).catch((cause: unknown) =>
                    console.error(`[extension] ${definition.id}`, cause),
                  )
                  throw new Error(
                    "Window setup must be synchronous. Start async work with createKeyed or createLatest.",
                  )
                }),
              (cause) => queueMicrotask(() => crash(cause)),
            ),
          ).then(() => {
            if (instances.get(definition.id) !== instance) return

            setState("status", definition.id, "active")
          }, crash)

        // Setup runs synchronously inside the extension root so its effects and memos are owned.
        if (windowStores(definition).length === 0) return start()

        // Global stores load in their storage namespace's one read before setup, so setup reads them as plain values.
        Promise.try(instance.prepare).then(() => {
          if (instances.get(definition.id) === instance) runWithOwner(root, start)
        }, crash)
      }),
    )
  }

  const createInstance = (
    definition: Definition,
    dispose: () => void,
    root: Owner | null,
    initial: Messages,
  ): Instance => {
    const extension = definition.id
    const controller = new AbortController()
    const cleanups = new Set<Cleanup>()

    const [catalog] = createResource(language.locale, (locale) => loadMessages(definition.i18n, locale), {
      initialValue: initial,
    })

    const messages = () => catalog.latest

    // Promise.try runs the cleanup synchronously and isolates a throw from the others.
    const release = (fn: Cleanup) =>
      void Promise.try(fn).catch((cause: unknown) => console.error(`[extension] ${extension}`, cause))

    const own = (fn: Cleanup): Cleanup => {
      // Work that outlives the extension, e.g. a promise callback, is released as soon as it registers.
      if (controller.signal.aborted) {
        release(fn)

        return () => {}
      }

      const cleanup = () => {
        if (cleanups.delete(cleanup)) return fn()
      }

      cleanups.add(cleanup)

      return cleanup
    }

    // The extension went away, or the scope registering (e.g. through a captured owner) already ended.
    const late = () => controller.signal.aborted || !!useContext(LifetimeContext)?.ended

    // Withdrawn with the current owner, or with the extension when there is none (after an await).
    const register = (fn: Cleanup): Cleanup => {
      if (late()) {
        release(fn)

        return () => {}
      }

      const cleanup = own(fn)
      const scope = getOwner()

      if (scope && scope !== root) onCleanup(() => void cleanup())

      return cleanup
    }

    const clients = new Map<string, { client: IpcClient<IpcSpec>; live: Live<unknown> }>()

    // One accessor per token, and one Live object per transition, so readers re-run only when the provider changes.
    const ipcLive = (token: Ipc | IpcRef): Live<unknown> => {
      if (!input.ipc) return inactive.disabled

      const full = resolve(token)
      const client = full && input.ipc(full)

      if (!full || !client) return absent(token.id, full ? (input.generation?.(full) ?? 0) : 0, true)

      const generation = input.generation?.(full) ?? 1
      const cached = clients.get(token.id)

      if (cached?.client === client && cached.live.status === "active" && cached.live.generation === generation)
        return cached.live

      const value = Object.assign({}, client, {
        on: (name: string, listener: Parameters<typeof client.on>[1]) => register(client.on(name, listener)),
      })

      const live = { status: "active", value, generation } as const

      clients.set(token.id, { client, live })

      return live
    }

    const lives = new Map<string, Accessor<Live<unknown>>>()

    const liveOf = (token: Token) => {
      const existing = lives.get(token.id)

      if (existing) return existing

      const read = Live.accessor(token.kind === "contract" ? () => contractLive(token) : () => ipcLive(token))

      lives.set(token.id, read)

      return read
    }

    const value = (read: Accessor<Live<unknown>>) => {
      const current = read()

      return current.status === "active" ? current.value : undefined
    }

    // A declared reference resolves once the chunk that loads its full token passes it to `load`, here and in other
    // extensions.
    const used = (token: Token) => {
      const read = liveOf(token)

      if (token.kind !== "ipc" || token.spec) return read

      return Object.assign(read, {
        load(full: Ipc) {
          if (full.id !== token.id) throw new Error(`Ipc "${full.id}" does not resolve the reference "${token.id}"`)
          learn(full)

          return read
        },
      })
    }

    // `ctx.uses` holds the extension's own tokens too; `Extension.define` refuses a key that names two tokens.
    const usable = { ...definition.provides, ...definition.uses }

    Object.values(usable).forEach(learn)
    Object.values(definition.requires ?? {}).forEach(learn)

    const stores: Stores = {}

    const context = {
      id: extension,
      signal: controller.signal,
      add<T>(registry: Registry<T>, item: T | (() => T | undefined)) {
        if (late()) return () => {}

        // Promise callbacks may have no owner; fall back to the extension root.
        const read =
          // SAFETY: a function item is the SDK's reactive form; registries take no function values.
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- see SAFETY above
          typeof item === "function"
            ? runWithOwner(getOwner() ?? root, () => createMemo(item as () => T | undefined))
            : () => item

        const key = `${extension}/${++sequence.value}`

        setState("entries", registry.id, (entries = []) => [
          ...entries,
          { key, registry: registry.id, extension, value: read ?? (() => undefined) },
        ])

        return register(() =>
          setState("entries", registry.id, (entries = []) => entries.filter((entry) => entry.key !== key)),
        )
      },
      list,
      provide<T>(token: Contract<T> | Ipc, impl: T) {
        if (token.kind === "ipc") throw new Error("Ipcs are provided by an extension's main entry")

        if (late()) return () => {}

        const generation = (generations.get(token.id) ?? 0) + 1

        generations.set(token.id, generation)

        const entry = { live: { status: "active", value: impl, generation } as const }

        provided.set(token.id, entry)
        setState("contracts", token.id, (version = 0) => version + 1)

        return register(() => {
          if (provided.get(token.id) !== entry) return

          provided.delete(token.id)
          setState("contracts", token.id, (version = 0) => version + 1)
        })
      },
      uses: Object.fromEntries(Object.entries(usable).map(([name, token]) => [name, used(token)])),
      // The host starts the extension only while every hard contract is active, and restarts it when one changes.
      requires: Object.fromEntries(
        Object.entries(definition.requires ?? {}).map(([name, token]) => [name, untrack(() => value(liveOf(token)))]),
      ),
      stores,
      t(key: string, params?: Record<string, string | number | boolean>) {
        const template = messages()[key]

        if (template !== undefined) return resolveTemplate(template, params)

        // SAFETY: a key the extension's catalog lacks is one of the app's shared keys, such as `common.*`.
        return language.t(key as Parameters<typeof language.t>[0], params)
      },
      plural(key: string, count: number, params?: Record<string, string | number | boolean>) {
        const current = messages()
        const template = current[`${key}.${pluralCategory(language.intl(), count)}`] ?? current[`${key}.other`]

        if (template !== undefined) return resolveTemplate(template, { ...params, count })

        // SAFETY: a key the extension's catalog lacks is one of the app's shared keys, such as `common.*`.
        return language.plural(key as Parameters<typeof language.plural>[0], count, params)
      },
    }

    // Each HostApi is created on the instance's first read of it.
    const created = new Map<string, HostApis[keyof HostApis]>()

    Object.defineProperties(
      context,
      Object.fromEntries(
        Object.entries(factories).map(([name, create]) => [
          name,
          {
            enumerable: true,
            get() {
              if (!created.has(name)) created.set(name, create(extension, root, typed, register))

              return created.get(name)
            },
          },
        ]),
      ),
    )

    // SAFETY: one implementation serves `Context` and every `SetupContext`: the declarations' records are built from
    // the definition, and every HostApi is a getter defined above.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
    const typed = context as unknown as InstanceContext

    const sessions: ReturnType<typeof createSessionStore<object>>[] = []

    return {
      definition,
      context: typed,
      prepare() {
        const storage = typed.storage

        const loaded = windowStores(definition).flatMap(([name, declaration]) => {
          if (declaration.scope === "global") {
            const handle = storage.store(name, { ...declaration, scope: "global" })

            stores[name] = handle

            return [whenLoaded(handle)]
          }

          const store = createSessionStore({
            open: (session) => storage.store(name, { ...declaration, scope: { session } }),
            owner: root,
            sessions: typed.sessions,
          })

          stores[name] = store.get
          sessions.push(store)

          return []
        })

        if (sessions.length > 0) own(() => sessions.forEach((store) => store.dispose()))

        return Promise.all(loaded)
      },
      preload: (session) => sessions.forEach((store) => store.get(session)),
      dispose() {
        controller.abort()
        // One batch: every contribution and contract of the extension disappears in the same frame.
        batch(() => {
          Array.from(cleanups).reverse().forEach(release)
          cleanups.clear()
          Object.entries(state.entries).forEach(([registry, entries]) => {
            if (!entries?.some((entry) => entry.extension === extension)) return

            setState("entries", registry, (list = []) => list.filter((entry) => entry.extension !== extension))
          })
        })
        // A throwing onCleanup in the extension's root must not stop the host disposing the rest.
        release(dispose)
      },
    }
  }

  const deactivate = (id: string) => {
    loads.delete(id)

    const instance = instances.get(id)

    if (!instance) return

    instances.delete(id)
    instance.dispose()
  }

  const fail = (id: string, cause: unknown, phase: ExtensionFailure["phase"] = "setup") => {
    console.error(`[extension] ${id}`, cause)
    batch(() => {
      // A contribution that fails to render renders nothing; the extension and its other contributions stay.
      if (phase === "setup") setState("status", id, "failed")

      setState("failures", id, {
        phase,
        error: cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
      })
    })
  }

  const replaced = new Map<string, Definition>()
  const latest = (definition: Definition) => replaced.get(definition.id) ?? definition

  // The startup gate: once every entry settled it stays open, so enabling or reloading an extension later
  // never unmounts the app. An entry waiting on a hard contract that is disabled or failed has settled too.
  const ready = createMemo<boolean>(
    (settled) =>
      settled ||
      (!!input.disabled() &&
        input.definitions.every((definition) => {
          if (!definition.renderer) return true

          const status = state.status[definition.id]

          if (status === "active" || status === "failed" || status === "disabled" || status === "blocked") return true

          return Object.values(definition.requires ?? {}).some((token) => {
            const provider = providerState(token)

            return blocked(provider)
          })
        })),
    false,
  )

  // `requires` gating: an extension starts once every hard contract is active and restarts with a new generation of
  // any of them. Activation is never ordered by the graph; only these extensions wait, and only for their contracts.
  input.definitions.forEach((definition) => {
    const tokens = Object.values(definition.requires ?? {})

    if (tokens.length === 0) return

    const key = createMemo(() => {
      const providers = tokens.map(providerState)

      if (providers.every((provider) => provider.status === "active"))
        return providers.map((provider) => (provider.status === "active" ? provider.generation : 0)).join(",")

      return providers.some(blocked) ? "blocked" : undefined
    })

    createRenderEffect(
      on(key, (value) =>
        untrack(() =>
          batch(() => {
            const id = definition.id

            deactivate(id)

            if (input.disabled()?.has(id) !== false) return

            if (value === undefined) return setState("status", id, "loading")

            if (value === "blocked") return setState("status", id, "blocked")

            void activate(latest(definition))
          }),
        ),
      ),
    )
  })

  // Establish requirement watchers before activation, including their initial state. Publish every disabled status
  // before starting enabled entries, so declaration order cannot leave a hard-dependency chain loading forever.
  createMemo(() => {
    const disabled = input.disabled()

    if (!disabled) return

    untrack(() =>
      batch(() => {
        input.definitions
          .filter((definition) => disabled.has(definition.id))
          .forEach((definition) => {
            deactivate(definition.id)
            setState("status", definition.id, "disabled")
          })
        input.definitions
          .filter((definition) => !disabled.has(definition.id))
          .forEach((definition) => {
            if (instances.has(definition.id) || state.status[definition.id] === "loading") return

            void activate(latest(definition))
          })
      }),
    )
  })

  onCleanup(() => {
    lifetime.disposed = true
    loads.clear()
    Array.from(instances.keys()).forEach(deactivate)
  })

  return {
    state,
    ready,
    list,
    items,
    links,
    definitions: () => input.definitions.map(latest),
    context: (id: string): Context | undefined => instances.get(id)?.context,
    fail,
    /** Starts loading every active extension's declared session stores for a session that mounts. */
    preload(session: SessionRef) {
      instances.forEach((instance) => instance.preload(session))
    },
    /** `next` replaces the definition, e.g. after a development hot update. */
    reload(id: string, next?: Definition) {
      const definition = next ?? input.definitions.find((item) => item.id === id)

      if (!definition) return

      if (next) replaced.set(id, next)

      batch(() => {
        deactivate(id)
        setState("failures", id, undefined)
        void activate(latest(definition))
      })
    },
  }
}

/** The window's declared stores; a `Store.main` store belongs to the main process. */
function windowStores(definition: Definition) {
  return Object.entries(definition.stores ?? {}).flatMap(([name, declaration]) =>
    declaration.scope === "main" ? [] : [[name, declaration] as const],
  )
}

/** A hard dependency that is not coming until its provider or configuration changes. */
function blocked(provider: Provider) {
  return provider.status === "inactive" && provider.reason !== "restarting"
}

/** English merged under the locale's messages. A catalog that fails to load leaves English. */
async function loadMessages(catalog: Catalog | undefined, locale: string): Promise<Messages> {
  const english = catalog?.en ?? {}
  const source = catalog?.[locale]

  if (!source || locale === "en") return english

  const loaded =
    // SAFETY: a catalog entry is either inline messages or the loader of a locale module, as `Catalog` types it.
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- see SAFETY above
    typeof source === "function"
      ? await source().then(
          (module) => module.default,
          () => ({}),
        )
      : source

  return { ...english, ...loaded }
}
