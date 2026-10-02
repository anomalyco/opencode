import {
  batch,
  createContext,
  createMemo,
  createResource,
  createRoot,
  ErrorBoundary,
  getOwner,
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
import { resolveTemplate } from "@solid-primitives/i18n"
import { useDialog } from "@opencode/ui/context/dialog"
import { pluralCategory } from "@opencode/ui/context/i18n"
import {
  Dialogs,
  ExtensionContext,
  Link,
  Links,
  type Catalog,
  type Cleanup,
  type Context,
  type Definition,
  type Host,
  type LinkHandler,
  type Messages,
  type Point,
  type Remote,
  type RemoteSpec,
  type Service,
} from "@opencode/gui-extensions/sdk"
import { useLanguage } from "@/runtime/i18n/language"

type Entry = { key: string; point: string; extension: string; value: Accessor<unknown> }
export type Item<T> = { readonly key: string; readonly extension: string; readonly value: T }
type Instance = { definition: Definition; context: Context; dispose: () => void }
type Bound = readonly {
  readonly token: Host<unknown>
  create(extension: string, owner: Owner | null, context: Context): unknown
}[]
export type ExtensionStatus = "loading" | "active" | "failed" | "disabled"

const HostContext = createContext<ReturnType<typeof createHost>>()

export function useExtensionHost() {
  const host = useContext(HostContext)
  if (!host) throw new Error("Extension host is unavailable")
  return host
}

export function ExtensionHostProvider(
  props: ParentProps<{
    definitions: readonly Definition[]
    disabled: Accessor<ReadonlySet<string> | undefined>
    services: Bound
    remote?: (token: Remote) => unknown
  }>,
) {
  const host = createHost(props)
  return <HostContext.Provider value={host}>{props.children}</HostContext.Provider>
}

function createHost(input: {
  definitions: readonly Definition[]
  disabled: Accessor<ReadonlySet<string> | undefined>
  services: Bound
  remote?: (token: Remote) => unknown
}) {
  const language = useLanguage()
  const owner = getOwner()
  const hosts = new Map(input.services.map((service) => [service.token.id, service]))
  const provided = new Map<string, { extension: string; impl: unknown }>()
  // Entries are indexed by point and services versioned by token, so a change wakes only its own readers.
  const [state, setState] = createStore({
    entries: {} as Record<string, Entry[] | undefined>,
    services: {} as Record<string, number | undefined>,
    status: {} as Record<string, ExtensionStatus | undefined>,
    errors: {} as Record<string, string | undefined>,
  })
  const instances = new Map<string, Instance>()
  const memos = new Map<string, Accessor<readonly Item<unknown>[]>>()
  const sequence = { value: 0 }
  // An entry that finishes loading after the host is gone must not create a root nothing disposes.
  const lifetime = { disposed: false }
  // The current load of each extension. Deactivating drops it and a reload replaces it, so an older load
  // neither sets up nor reports a failure over its replacement.
  const loads = new Map<string, object>()

  const items = <T,>(point: Point<T>) => {
    const existing = memos.get(point.id)
    if (existing) return existing() as readonly Item<T>[]
    // Reuse each item object while its value is unchanged so keyed renders do not remount.
    const cache = new Map<string, Item<unknown>>()
    const created = runWithOwner(owner, () =>
      createMemo(() => {
        const next = (state.entries[point.id] ?? []).flatMap((entry) => {
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
    )!
    memos.set(point.id, created)
    return created() as unknown as readonly Item<T>[]
  }
  const list = <T,>(point: Point<T>) => items(point).map((item) => item.value)

  const links: Links = {
    open(link) {
      const handler = untrack(() => list(Link))
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
  hosts.set(Links.id, { token: Links, create: () => links })

  const dialog = useDialog()
  hosts.set(Dialogs.id, {
    token: Dialogs,
    // Bound to the instance that asked, so an older async call after a disable or reload opens and closes nothing.
    create: (extension, _, context): Dialogs => {
      const open = (method: "show" | "push") => (render: () => JSX.Element) => {
        if (context.signal.aborted) return
        const id = `extension:${extension}:${sequence.value++}`
        // Closes this dialog, not whichever is on top, when the extension goes away.
        const release = context.cleanup(() => dialog.close(id))
        void dialog[method](
          () => {
            // The dialog's root disposes when it closes or another dialog replaces it.
            onCleanup(() => void release())
            return (
              <ErrorBoundary
                fallback={(error) => {
                  onMount(() => {
                    dialog.close(id)
                    fail(extension, error)
                  })
                  return null
                }}
              >
                <ExtensionContext.Provider value={context}>{untrack(render)}</ExtensionContext.Provider>
              </ErrorBoundary>
            )
          },
          undefined,
          id,
          // The stack mounts in a later transition; disposal before then must still keep it closed.
          context.signal,
        )
      }
      return {
        show: open("show"),
        push: open("push"),
        close: () => {
          if (!context.signal.aborted) dialog.close()
        },
        active: () => !!dialog.active,
      }
    },
  })

  const activate = async (definition: Definition) => {
    const load = definition.renderer
    // A disabled extension, e.g. one reloaded from settings, stays disabled: marking it loading would make the
    // enable watcher skip it later. Before the list loads nothing activates; the watcher starts each entry then.
    if (!load || input.disabled()?.has(definition.id) !== false) return
    const attempt = {}
    const current = () => loads.get(definition.id) === attempt
    loads.set(definition.id, attempt)
    setState("status", definition.id, "loading")
    // The current language's catalog loads with the entry, so the first render is already translated.
    const [module, messages] = await Promise.all([
      load().catch((error: unknown) => {
        if (current()) fail(definition.id, error)
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
        const instance = createInstance(definition, dispose, getOwner(), messages)
        instances.set(definition.id, instance)
        // Setup runs synchronously inside the extension root so its effects and memos are owned.
        void Promise.try(() => untrack(() => module.default(instance.context))).then(
          (cleanup) => {
            // Registered first: if the extension already went away, the cleanup runs now.
            if (typeof cleanup === "function") instance.context.cleanup(cleanup)
            if (instances.get(definition.id) !== instance) return
            setState("status", definition.id, "active")
          },
          (error: unknown) => {
            if (instances.get(definition.id) !== instance) return
            deactivate(definition.id)
            fail(definition.id, error)
          },
        )
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
    const created = new Map<string, unknown>()
    // Promise.try runs the cleanup synchronously and isolates a throw from the others.
    const release = (fn: Cleanup) =>
      void Promise.try(fn).catch((error: unknown) => console.error(`[extension] ${extension}`, error))
    const own = (fn: Cleanup): Cleanup => {
      // Work that outlives the extension, e.g. after an await in setup, is released as soon as it registers.
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
    const context = {
      id: extension,
      signal: controller.signal,
      cleanup: own,
      add(point: Point<unknown>, item: unknown) {
        if (controller.signal.aborted) return () => {}
        // Work after an await in setup has no owner; fall back to the extension root.
        const value =
          typeof item === "function"
            ? runWithOwner(getOwner() ?? root, () => createMemo(item as () => unknown))!
            : () => item
        const key = `${extension}/${++sequence.value}`
        setState("entries", point.id, (entries = []) => [...entries, { key, point: point.id, extension, value }])
        return own(() => setState("entries", point.id, (entries = []) => entries.filter((entry) => entry.key !== key)))
      },
      list,
      provide(token: Service<unknown> | Remote, impl: unknown) {
        if (token.kind === "remote") throw new Error("Remotes are provided by an extension's main entry")
        if (controller.signal.aborted) return () => {}
        provided.set(token.id, { extension, impl })
        setState("services", token.id, (value = 0) => value + 1)
        return own(() => {
          if (provided.get(token.id)?.extension !== extension) return
          provided.delete(token.id)
          setState("services", token.id, (value = 0) => value + 1)
        })
      },
      use(token: Host<unknown> | Service<unknown> | Remote<RemoteSpec>) {
        if (token.kind === "host") {
          if (created.has(token.id)) return created.get(token.id)
          const service = hosts.get(token.id)
          if (!service) throw new Error(`Host service "${token.id}" is unavailable`)
          const value = service.create(extension, root, context)
          created.set(token.id, value)
          return value
        }
        if (token.kind === "service")
          return () => {
            void state.services[token.id]
            return provided.get(token.id)?.impl
          }
        return () => input.remote?.(token)
      },
      t(key: string, params?: Record<string, string | number | boolean>) {
        const template = messages()[key]
        if (template !== undefined) return resolveTemplate(template, params)
        return language.t(key as Parameters<typeof language.t>[0], params)
      },
      plural(key: string, count: number, params?: Record<string, string | number | boolean>) {
        const current = messages()
        const template = current[`${key}.${pluralCategory(language.intl(), count)}`] ?? current[`${key}.other`]
        if (template !== undefined) return resolveTemplate(template, { ...params, count })
        return language.plural(key as Parameters<typeof language.plural>[0], count, params)
      },
    } as unknown as Context
    return {
      definition,
      context,
      dispose() {
        controller.abort()
        // One batch: every contribution and service of the extension disappears in the same frame.
        batch(() => {
          Array.from(cleanups).reverse().forEach(release)
          cleanups.clear()
          Object.entries(state.entries).forEach(([point, entries]) => {
            if (!entries?.some((entry) => entry.extension === extension)) return
            setState("entries", point, (list = []) => list.filter((entry) => entry.extension !== extension))
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

  const fail = (id: string, error: unknown) => {
    console.error(`[extension] ${id}`, error)
    batch(() => {
      setState("status", id, "failed")
      setState("errors", id, error instanceof Error ? (error.stack ?? error.message) : String(error))
    })
  }

  const replaced = new Map<string, Definition>()
  const latest = (definition: Definition) => replaced.get(definition.id) ?? definition

  // The startup gate: once every entry settled it stays open, so enabling or reloading an extension later
  // never unmounts the app.
  const ready = createMemo<boolean>(
    (settled) =>
      settled ||
      (!!input.disabled() &&
        input.definitions.every((definition) => {
          if (!definition.renderer) return true
          const status = state.status[definition.id]
          return status === "active" || status === "failed" || status === "disabled"
        })),
    false,
  )

  createMemo(() => {
    const disabled = input.disabled()
    if (!disabled) return
    untrack(() =>
      input.definitions.forEach((definition) => {
        if (disabled.has(definition.id)) {
          deactivate(definition.id)
          setState("status", definition.id, "disabled")
          return
        }
        if (instances.has(definition.id) || state.status[definition.id] === "loading") return
        void activate(latest(definition))
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
    context: (id: string) => instances.get(id)?.context,
    fail,
    /** `next` replaces the definition, e.g. after a development hot update. */
    reload(id: string, next?: Definition) {
      const definition = next ?? input.definitions.find((item) => item.id === id)
      if (!definition) return
      if (next) replaced.set(id, next)
      deactivate(id)
      setState("errors", id, undefined)
      void activate(latest(definition))
    },
  }
}

/** English merged under the locale's messages. A catalog that fails to load leaves English. */
async function loadMessages(catalog: Catalog | undefined, locale: string): Promise<Messages> {
  const english = catalog?.en ?? {}
  const source = catalog?.[locale]
  if (!source || locale === "en") return english
  const loaded =
    typeof source === "function"
      ? await source().then(
          (module) => module.default,
          () => ({}),
        )
      : source
  return { ...english, ...loaded }
}
