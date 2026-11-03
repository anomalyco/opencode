import { abort } from "@opencode/util/abort"
import {
  batch,
  catchError,
  createContext,
  createMemo,
  createRenderEffect,
  createResource,
  createRoot,
  ErrorBoundary,
  getOwner,
  on,
  onCleanup,
  onMount,
  runWithOwner,
  untrack,
  useContext,
  type Accessor,
  type JSX,
  type Owner,
  type ParentProps,
} from "solid-js"
import { createStore } from "solid-js/store"
import { LifetimeContext, liveAccessor, PluginContext, type Entry } from "@opencode/plugin/gui/host"
import type { BuiltinCatalog, BuiltinContext } from "@opencode/plugin/gui/builtin"
import { Predicate } from "effect"
import { useDialog } from "@opencode/ui/context/dialog"
import { pluralCategory, resolveTemplate } from "@opencode/ui/context/i18n"
import {
  LinkHandler,
  type BaseContext,
  type Cleanup,
  type Context,
  type Contract,
  type DialogHandle,
  type Dialogs,
  type Link,
  type Links,
  type Live,
  type Messages,
  type Persisted,
  type PluginOptions,
  type Registry,
  type SelectOptions,
  type Ipc,
  type IpcClient,
  type IpcSpec,
  type SessionRef,
  type SetupContext,
  type Token,
} from "@opencode/plugin/gui"
import { OpenCode, type OpenCodeClient } from "@opencode/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { PluginAlertDialog, PluginConfirmDialog, PluginPromptDialog, PluginSelectDialog } from "./dialogs"
import { createSessionStore, whenLoaded } from "./stores"

type Contribution = { key: string; registry: string; plugin: string; value: Accessor<unknown> }

export type Item<T> = { readonly key: string; readonly plugin: string; readonly value: T }

/**
 * The context the host builds: every `Setup<D>` of the definition receives it, and contributions read it as `Context`.
 * It has the members only built-ins use, which `builtinContext` reads.
 */
type InstanceContext = SetupContext<Entry> & BuiltinContext

type Instance = {
  definition: Entry
  context: InstanceContext
  dispose: () => void
  /** Runs `fn` when the instance goes away, as a cleanup a setup returns. */
  own(fn: Cleanup): Cleanup
  /** Opens the declared stores. Settles once the global stores have loaded. */
  prepare(): Promise<readonly void[]>
  /** Starts loading the declared session stores for a mounted session. */
  preload(session: SessionRef): void
}

/** What a plugin's GUI reads of its plugin: its options, and the client of the server that runs it, read each time. */
export type PluginInput = { readonly options: PluginOptions; readonly client: () => OpenCodeClient | undefined }

/** The APIs a window context exposes as properties. */
type HostApis = Omit<BuiltinContext, keyof BaseContext | "provide" | "use" | "main">

/**
 * Creates one HostApi for a plugin instance, on the instance's first read of it. `register` withdraws what it is
 * given with the caller's owner, else with the plugin. `builtin` is true for a plugin that ships with the app.
 */
type HostApiFactory<T> = (
  plugin: string,
  owner: Owner | null,
  context: Context,
  register: (fn: Cleanup) => Cleanup,
  builtin: boolean,
) => T

/** The HostApis a window provides, by context property. The host itself provides `links` and `dialogs`. */
export type HostApiFactories = {
  readonly [K in Exclude<keyof HostApis, "links" | "dialogs">]: HostApiFactory<HostApis[K]>
}

export type PluginStatus = "loading" | "active" | "failed" | "disabled"

/** The last error a plugin raised: in its setup or an effect, or while one of its contributions rendered. */
export type PluginFailure = { readonly phase: "setup" | "render"; readonly error: string }

type Absent = Exclude<Live<never>, { readonly status: "active" }>

type HostState = {
  entries: Record<string, Contribution[] | undefined>
  contracts: Record<string, number | undefined>
  status: Record<string, PluginStatus | undefined>
  failures: Record<string, PluginFailure | undefined>
}

type Stores = Record<string, Persisted<object> | ((session: SessionRef) => Persisted<object>)>

const pending: Absent = { status: "pending" }

const inactive = {
  disabled: { status: "inactive", reason: "disabled" },
  failed: { status: "inactive", reason: "failed" },
} as const satisfies Record<string, Absent>

const HostContext = createContext<ReturnType<typeof createHost>>()

export function usePluginHost() {
  const host = useContext(HostContext)

  if (!host) throw new Error("Plugin host is unavailable")

  return host
}

type HostInput = {
  definitions: Accessor<readonly Entry[]>
  disabled: Accessor<ReadonlySet<string> | undefined>
  apis: HostApiFactories
  /**
   * Runs `run` once the app interface has mounted, behind the HostApis writes made before it, or now when it has.
   * Returns a cancel for a run that still waits.
   */
  whenMounted: (run: () => void) => () => void
  /** The renderer client of an Ipc while it is available; omitted where there is no main process. */
  ipc?: (token: Ipc) => IpcClient<IpcSpec> | undefined
  /** What a plugin's GUI reads of its plugin: its options, and the client of the server that runs it. */
  plugin?: (id: string) => PluginInput | undefined
  /** How many times an Ipc became available. Reactive. */
  generation?: (token: Ipc) => number
  /** A plugin's main entry failed. Reactive. */
  failed?: (id: string) => boolean
}

export function PluginHostProvider(props: ParentProps<HostInput>) {
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
  // The current load of each plugin. Deactivating drops it and a reload replaces it, so an older load
  // neither sets up nor reports a failure over its replacement.
  const loads = new Map<string, object>()

  // The plugin that provides a token: the one whose id the token's id is, or prefixes.
  const providers = new Map<string, string | undefined>()

  const all = input.definitions

  const providerOf = (id: string) => {
    const current = providers.get(id)

    if (current) return current

    // Tracked while unresolved: a plugin that joins later resolves its readers.
    const definitions = all()

    const found = definitions.find((definition) => owns(definition.id, id))

    if (found) providers.set(id, found.id)

    return found?.id
  }

  // Why a token has no active provider. Main-side providers report through the installed list.
  const absent = (id: string, main: boolean): Absent => {
    const plugin = providerOf(id)

    if (!plugin) return inactive.disabled

    if (main ? input.disabled()?.has(plugin) : state.status[plugin] === "disabled") return inactive.disabled

    if (main ? input.failed?.(plugin) : state.status[plugin] === "failed") return inactive.failed

    // A renderer provider that is up but does not provide the token (e.g. on this platform) is not coming.
    if (!main && state.status[plugin] === "active") return inactive.disabled

    return pending
  }

  const contractLive = (token: Contract<unknown>): Live<unknown> => {
    void state.contracts[token.id]

    return provided.get(token.id)?.live ?? absent(token.id, false)
  }

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

          const item = { key: entry.key, plugin: entry.plugin, value }

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

  const pickLinkHandler = (link: Link) =>
    list(LinkHandler)
      .filter((item) => item.match(link))
      .reduce<LinkHandler | undefined>(
        (best, item) => (!best || (item.priority ?? 0) > (best.priority ?? 0) ? item : best),
        undefined,
      )

  const links: Links = {
    open(link) {
      const handler = untrack(() => pickLinkHandler(link))

      if (!handler) return false

      handler.open(link)

      return true
    },
    // Markdown asks from inside its render effect; untracked so a session or screen switch never reruns it.
    exists: (link) => untrack(() => pickLinkHandler(link)?.exists?.(link) ?? false),
  }

  const dialog = useDialog()

  const factories = {
    ...input.apis,
    links: () => links,
    // Bound to the instance that asked, so an older async call after a disable or reload opens and closes nothing.
    dialogs: (plugin, _, context, register): Dialogs => {
      // `ended` runs when the dialog closes, however it closes, and when it can no longer open.
      const open = (
        render: (dialog: DialogHandle) => JSX.Element,
        options?: { readonly replace?: boolean },
        ended?: () => void,
      ): DialogHandle => {
        const id = `plugin:${plugin}:${sequence.value++}`
        const waiting = { cancel: () => {} }
        // This open alone: once it aborts, a deferred open neither mounts nor replaces another dialog.
        const opening = new AbortController()

        // Each handle names its own dialog, so it never closes one another plugin or instance opened. Closing a
        // dialog that still waits for the app interface, or for its deferred open, cancels it.
        const close = () => {
          abort(opening)
          waiting.cancel()
          dialog.close(id)
          ended?.()
        }

        const handle = { close }

        if (context.signal.aborted) {
          ended?.()

          return handle
        }

        // Closes this dialog, not whichever is on top, when the plugin or the scope that opened it goes away.
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
                        fail(plugin, error, "render")
                      })

                      return null
                    }}
                  >
                    <PluginContext.Provider value={context}>{untrack(() => render(handle))}</PluginContext.Provider>
                  </ErrorBoundary>
                )
              },
              // Escape, a click outside, a replacing dialog, or an open the stack dropped.
              ended,
              id,
              // The stack mounts in a later transition. Its handle, its owner or the plugin ending before then keeps
              // it closed.
              AbortSignal.any([opening.signal, context.signal]),
            ),
        )

        return handle
      }

      // Settles with the content's answer, or with `fallback` once the dialog ends without one; the first wins.
      const ask = <T,>(fallback: T, content: (answer: (value: T) => void) => JSX.Element) =>
        new Promise<T>((resolve) => {
          open(
            (handle) =>
              content((value) => {
                resolve(value)
                handle.close()
              }),
            undefined,
            () => resolve(fallback),
          )
        })

      return {
        open: (render, options) => open(render, options),
        active: () => !!dialog.active,
        confirm: (options) => ask(false, (answer) => <PluginConfirmDialog options={options} done={answer} />),
        alert: (options) =>
          ask(undefined, (answer) => <PluginAlertDialog options={options} done={() => answer(undefined)} />),
        prompt: (options) =>
          ask<string | undefined>(undefined, (answer) => <PluginPromptDialog options={options} done={answer} />),
        select: <T,>(options: SelectOptions<T>) =>
          ask<T | undefined>(undefined, (answer) => <PluginSelectDialog options={options} done={answer} />),
      }
    },
  } satisfies { readonly [K in keyof HostApis]: HostApiFactory<HostApis[K]> }

  const activate = async (definition: Entry) => {
    const load = definition.windowEntry

    // A disabled plugin, e.g. one reloaded from settings, stays disabled: marking it loading would make the
    // enable watcher skip it later. Before the list loads nothing activates; the watcher starts each entry then.
    if (!load || input.disabled()?.has(definition.id) !== false) return

    setState("status", definition.id, "loading")

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

        // Setup and every scope under it read the plugin's context, e.g. `createKeyed` with a token.
        if (root) root.context = { ...root.context, [PluginContext.id]: instance.context }

        const crash = (cause: unknown) => {
          if (instances.get(definition.id) !== instance) return

          batch(() => {
            deactivate(definition.id)
            fail(definition.id, cause)
          })
        }

        // SAFETY: the host context implements the parameter of every `Setup<D>` of this definition.
        const setup = module.default as (ctx: InstanceContext) => Cleanup | void

        const start = () =>
          void Promise.try(() =>
            // Errors from the plugin's own effects, at setup or later, fail the plugin and nothing else.
            catchError(
              () =>
                untrack(() => {
                  const returned = setup(instance.context)

                  // A returned cleanup runs when the plugin goes away, as server and TUI plugins' do.
                  if (Predicate.isFunction(returned)) return void instance.own(returned)

                  if (!Predicate.isPromiseLike(returned)) return

                  // Do not await invalid setup, but consume its eventual rejection after the instance is aborted.
                  void Promise.resolve(returned).catch((cause: unknown) =>
                    console.error(`[plugin] ${definition.id}`, cause),
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

        // Setup runs synchronously inside the plugin root so its effects and memos are owned.
        if (windowStores(definition).length === 0) return start()

        // Global stores load in their storage namespace's one read before setup, so setup reads them as plain values.
        Promise.try(instance.prepare).then(() => {
          if (instances.get(definition.id) === instance) runWithOwner(root, start)
        }, crash)
      }),
    )
  }

  const createInstance = (definition: Entry, dispose: () => void, root: Owner | null, initial: Messages): Instance => {
    const plugin = definition.id
    const controller = new AbortController()
    const cleanups = new Set<Cleanup>()

    const [catalog] = createResource(language.locale, (locale) => loadMessages(definition.i18n, locale), {
      initialValue: initial,
    })

    const messages = () => catalog.latest

    // Promise.try runs the cleanup synchronously and isolates a throw from the others.
    const release = (fn: Cleanup) =>
      void Promise.try(fn).catch((cause: unknown) => console.error(`[plugin] ${plugin}`, cause))

    const own = (fn: Cleanup): Cleanup => {
      // Work that outlives the plugin, e.g. a promise callback, is released as soon as it registers.
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

    // The plugin went away, or the scope registering (e.g. through a captured owner) already ended.
    const late = () => controller.signal.aborted || !!useContext(LifetimeContext)?.ended

    // Withdrawn with the current owner, or with the plugin when there is none (after an await).
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
    const ipcLive = (token: Ipc): Live<unknown> => {
      if (!input.ipc) return inactive.disabled

      const client = input.ipc(token)

      if (!client) return absent(token.id, true)

      const generation = input.generation?.(token) ?? 1
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

      const read = liveAccessor(token.kind === "contract" ? () => contractLive(token) : () => ipcLive(token))

      lives.set(token.id, read)

      return read
    }

    const mains = new Map<string, IpcClient<IpcSpec>>()

    // The client of the plugin's own Ipc: calls wait while its main entry starts and reject once it cannot answer.
    const mainClient = (token: Ipc): IpcClient<IpcSpec> => {
      if (!owns(plugin, token.id)) throw new Error(`${plugin} calls only its own main entry, not Ipc "${token.id}"`)

      const existing = mains.get(token.id)

      if (existing) return existing

      // SAFETY: an Ipc's active value is the client `ipcLive` builds for it.
      const read = liveOf(token) as Accessor<Live<IpcClient<IpcSpec>>>

      const unavailable = (reason: string) => new Error(`Ipc "${token.id}" is unavailable: ${reason}`)

      const ready = (): Promise<IpcClient<IpcSpec>> => {
        // A client kept past the plugin's instance never reaches main again, even while main still provides.
        if (controller.signal.aborted) return Promise.reject(unavailable("the plugin went away"))

        const current = untrack(read)

        if (current.status === "active") return Promise.resolve(current.value)

        if (current.status === "inactive") return Promise.reject(unavailable(current.reason))

        return new Promise((resolve, reject) =>
          runWithOwner(owner, () =>
            createRoot((dispose) => {
              const stop = () => {
                controller.signal.removeEventListener("abort", aborted)
                dispose()
              }

              const aborted = () => {
                stop()
                reject(unavailable("the plugin went away"))
              }

              controller.signal.addEventListener("abort", aborted)

              createRenderEffect(
                on(
                  read,
                  (live) => {
                    if (live.status === "pending") return

                    stop()

                    if (live.status === "active") return resolve(live.value)

                    reject(unavailable(live.reason))
                  },
                  { defer: true },
                ),
              )
            }),
          ),
        )
      }

      const methods = Object.fromEntries(
        Object.keys(token.spec.methods).map((name) => [
          name,
          (...args: readonly unknown[]) =>
            ready().then((client) => {
              const method = Predicate.hasProperty(client, name) ? client[name] : undefined

              if (!isMethod(method)) throw unavailable(`no method "${name}"`)

              return method(...args)
            }),
        ]),
      )

      const client = Object.assign(methods, {
        state() {
          const live = read()

          return live.status === "active" ? live.value.state() : undefined
        },
        on(name: string, listener: Parameters<IpcClient<IpcSpec>["on"]>[1]) {
          // Follows the main entry across restarts: each active client gets the listener, removed when it changes.
          return register(
            runWithOwner(root, () =>
              createRoot((dispose) => {
                createRenderEffect(() => {
                  const live = read()

                  if (live.status === "active") live.value.on(name, listener)
                })

                return dispose
              }),
            ) ?? (() => {}),
          )
        },
      })

      // SAFETY: `methods` has one function per method of the token's spec, as `IpcClient` types it.
      const typed = client as IpcClient<IpcSpec>

      mains.set(token.id, typed)

      return typed
    }

    const stores: Stores = {}

    const gui = input.plugin?.(plugin)

    const context = {
      id: plugin,
      options: gui?.options ?? {},
      get client() {
        return gui?.client() ?? unavailableClient()
      },
      signal: controller.signal,
      add<T>(registry: Registry<T>, item: T | (() => T | undefined)) {
        if (late()) return () => {}

        // Promise callbacks may have no owner; fall back to the plugin root.
        const read =
          // SAFETY: a function item is the SDK's reactive form; registries take no function values.
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- see SAFETY above
          typeof item === "function"
            ? runWithOwner(getOwner() ?? root, () => createMemo(item as () => T | undefined))
            : () => item

        const key = `${plugin}/${++sequence.value}`

        setState("entries", registry.id, (entries = []) => [
          ...entries,
          { key, registry: registry.id, plugin, value: read ?? (() => undefined) },
        ])

        return register(() =>
          setState("entries", registry.id, (entries = []) => entries.filter((entry) => entry.key !== key)),
        )
      },
      list,
      provide<T>(token: Contract<T> | Ipc, impl: T) {
        if (token.kind === "ipc") throw new Error("Ipcs are provided by a plugin's main entry")

        if (!owns(plugin, token.id)) throw new Error(`${plugin} provides only its own contracts, not "${token.id}"`)

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
      use: liveOf,
      main: mainClient,
      stores,
      t(key: string, params?: Record<string, string | number | boolean>) {
        const template = messages()[key]

        if (template !== undefined) return resolveTemplate(template, params)

        // SAFETY: a key the plugin's catalog lacks is one of the app's shared keys, such as `common.*`.
        return language.t(key as Parameters<typeof language.t>[0], params)
      },
      plural(key: string, count: number, params?: Record<string, string | number | boolean>) {
        const current = messages()
        const template = current[`${key}.${pluralCategory(language.intl(), count)}`] ?? current[`${key}.other`]

        if (template !== undefined) return resolveTemplate(template, { ...params, count })

        // SAFETY: a key the plugin's catalog lacks is one of the app's shared keys, such as `common.*`.
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
              if (!created.has(name)) created.set(name, create(plugin, root, typed, register, !gui))

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
      own,
      prepare() {
        const storage = typed.storage

        const loaded = windowStores(definition).flatMap(([name, declaration]) => {
          const options = {
            schema: declaration.schema,
            initial: declaration.initial,
            from: declaration.builtinFrom ?? declaration.from,
          }

          if (declaration.scope === "global") {
            const handle = storage.store(name, { ...options, scope: "global" })

            stores[name] = handle

            return [whenLoaded(handle)]
          }

          const store = createSessionStore({
            open: (session) => storage.store(name, { ...options, scope: { session } }),
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
        abort(controller)
        // One batch: every contribution and contract of the plugin disappears in the same frame.
        batch(() => {
          Array.from(cleanups).reverse().forEach(release)
          cleanups.clear()
          Object.entries(state.entries).forEach(([registry, entries]) => {
            if (!entries?.some((entry) => entry.plugin === plugin)) return

            setState("entries", registry, (list = []) => list.filter((entry) => entry.plugin !== plugin))
          })
        })
        // A throwing onCleanup in the plugin's root must not stop the host disposing the rest.
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

  const fail = (id: string, cause: unknown, phase: PluginFailure["phase"] = "setup") => {
    console.error(`[plugin] ${id}`, cause)
    batch(() => {
      // A contribution that fails to render renders nothing; the plugin and its other contributions stay.
      if (phase === "setup") setState("status", id, "failed")

      setState("failures", id, {
        phase,
        error: cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
      })
    })
  }

  const replaced = new Map<string, Entry>()
  const latest = (definition: Entry) => replaced.get(definition.id) ?? definition

  // The definitions the host starts with: the built-ins. Definitions that join later (plugins) never hold the gate.
  const initial = new Set(untrack(all))

  // The startup gate: once every entry settled it stays open, so enabling or reloading a plugin later
  // never unmounts the app.
  const ready = createMemo<boolean>(
    (settled) =>
      settled ||
      (!!input.disabled() &&
        [...initial].every((definition) => {
          if (!definition.windowEntry) return true

          const status = state.status[definition.id]

          return status === "active" || status === "failed" || status === "disabled"
        })),
    false,
  )

  // The definition object each id was last listed with; a new object for a listed id replaces it.
  const listed = new Map<string, Entry>()

  // Forgets everything about a plugin whose definition left or was replaced, so the next pass starts it afresh.
  const forget = (id: string) => {
    deactivate(id)
    replaced.delete(id)
    providers.forEach((plugin, token) => {
      if (plugin === id) providers.delete(token)
    })
    setState("status", id, undefined)
    setState("failures", id, undefined)
  }

  // Publish every disabled status before starting enabled entries.
  createMemo(() => {
    const disabled = input.disabled()
    const definitions = all()

    if (!disabled) return

    untrack(() =>
      batch(() => {
        const ids = new Set(definitions.map((definition) => definition.id))
        Array.from(listed.keys()).forEach((id) => {
          if (ids.has(id)) return
          listed.delete(id)
          forget(id)
        })
        definitions.forEach((definition) => {
          const before = listed.get(definition.id)
          listed.set(definition.id, definition)

          if (before && before !== definition) forget(definition.id)
        })
        definitions
          .filter((definition) => disabled.has(definition.id))
          .forEach((definition) => {
            deactivate(definition.id)
            setState("status", definition.id, "disabled")
            // A plugin that is off shows no error from its last run.
            setState("failures", definition.id, undefined)
          })
        definitions
          .filter((definition) => !disabled.has(definition.id))
          .forEach((definition) => {
            // A failed plugin waits for Reload or a new revision, as in main.
            if (instances.has(definition.id)) return

            if (state.status[definition.id] === "loading" || state.status[definition.id] === "failed") return

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
    definitions: () => all().map(latest),
    context: (id: string): Context | undefined => instances.get(id)?.context,
    fail,
    /** Starts loading every active plugin's declared session stores for a session that mounts. */
    preload(session: SessionRef) {
      instances.forEach((instance) => instance.preload(session))
    },
    /** `next` replaces the definition, e.g. after a development hot update. */
    reload(id: string, next?: Entry) {
      const definition = next ?? untrack(all).find((item) => item.id === id)

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

/** The window's declared stores. */
function windowStores(definition: Entry) {
  return Object.entries(definition.stores ?? {})
}

/** The client `unavailableClient` made, once a plugin first read it. */
type Unavailable = { client?: OpenCodeClient }

const unavailable: Unavailable = {}

/** The client a plugin reads while the server that runs it is unreachable: every call rejects. */
function unavailableClient() {
  return (unavailable.client ??= OpenCode.make({
    baseUrl: "http://unavailable.invalid/",
    fetch: Object.assign(() => Promise.reject(new Error("The server that runs this plugin is unavailable")), {
      preconnect() {},
    }),
  }))
}

// An Ipc client from the bridge is plain JavaScript; check a method before calling it.
// SAFETY: the method's output schema decodes its reply; the `IpcClient` the plugin holds types it.
// oxlint-disable-next-line anti-slop/no-unknown-returns -- see SAFETY above
function isMethod(value: unknown): value is (...args: readonly unknown[]) => Promise<unknown> {
  return Predicate.isFunction(value)
}

/** Whether a plugin owns a token: its id is the plugin's, or is under it (`<plugin>.<name>`). */
function owns(plugin: string, id: string) {
  return id === plugin || id.startsWith(`${plugin}.`)
}

/** English merged under the locale's messages. A catalog that fails to load leaves English. */
async function loadMessages(catalog: BuiltinCatalog | undefined, locale: string): Promise<Messages> {
  const english = catalog?.en ?? {}
  const source = catalog?.[locale]

  if (!source || locale === "en") return english

  const loaded =
    // SAFETY: a catalog entry is either inline messages or the loader of a locale module, as `BuiltinCatalog` types it.
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- see SAFETY above
    typeof source === "function"
      ? await source().then(
          (module) => module.default,
          () => ({}),
        )
      : source

  return { ...english, ...loaded }
}
