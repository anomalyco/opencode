import { app, BrowserWindow } from "electron"
import { builtins } from "@opencode/gui-extensions/main"
import type { BridgeLayout, BridgeMenubarItem } from "@opencode/gui-extensions/sdk/bridge"
import {
  Cli,
  MainApp,
  MainStorage,
  Menubar,
  Surfaces,
  Windows,
  type Caller,
  type Catalog,
  type Cleanup,
  type Context,
  type Host,
  type MainServer,
  type Messages,
  type OS,
  type Params,
  type Point,
  type Provided,
  type Remote,
  type RemoteClient,
  type RemoteImpl,
  type RemoteSpec,
  type Service,
  type Setup,
} from "@opencode/gui-extensions/sdk/main"
import { Exit, Predicate, Schema } from "effect"
import type { Accessor } from "solid-js"
import type { ExtensionEndpoint, ExtensionInstalled } from "../../shared/ipc-rpc/extensions"
import {
  ExtensionAvailable,
  ExtensionEvent,
  ExtensionMenubarChanged,
  ExtensionState,
  ExtensionsChanged,
  type DesktopEvent,
} from "../../shared/ipc-rpc/events"
import { CHANNEL, VERSION } from "../constants"
import { emitIpcEvent } from "../ipc-events"
import { refreshMenu, setMenubarProvider } from "../native/menu"
import {
  formatNativeTemplate,
  nativeLocale,
  nativeMessage,
  nativePluralCategory,
  onNativeTranslations,
} from "../native/translations"
import { SidecarCredentials } from "../service/sidecar-credentials"
import type { Database } from "../storage/database"
import type { StateStore } from "../storage/state"
import { getLastFocusedWindow, getMainWindows, onMainWindow } from "../windows"
import { ExtensionError } from "./error"
import { createManager } from "./manager"
import { evaluateMain } from "./module"
import { createMainStorage, namespace } from "./storage"
import { createSurfaces } from "./surfaces"

const CLEANUP_TIMEOUT_MS = 3_000

export type ExtensionHost = ReturnType<typeof createHost>

type Loaded = { readonly setup: Setup; readonly i18n?: Catalog }
type Method = (input: unknown, caller: Caller) => unknown
type Provider = {
  readonly extension: string
  readonly signal: AbortSignal
  readonly spec: RemoteSpec
  readonly methods: ReadonlyMap<string, Method>
  readonly state?: (window: number) => unknown
  readonly listeners: Set<(name: string, data: unknown) => void>
}
type Entry = { readonly point: string; readonly extension: string; readonly value: unknown }
type Outcome = { readonly ok: true } | { readonly ok: false; readonly error: unknown }
type Instance = {
  readonly context: Context
  readonly catalog?: Catalog
  messages: Messages
  /** Runs setup once. The cleanup it returns belongs to the instance, even when setup settles after disposal. */
  start(setup: Setup): Promise<Outcome>
  /**
   * Withdraws everything the instance contributed at once, then settles once its cleanups and a setup still
   * running have finished, or the timeout passed. Idempotent.
   */
  dispose(): Promise<void>
}

const os: OS = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"

/**
 * The main-process GUI extension host. Every main extension is an app-scoped singleton; windows
 * reach its remotes over the bridge and main scopes state and events by `caller.window`.
 */
export function createHost(input: {
  readonly db: Database
  readonly state: StateStore
  readonly cli: Cli
  /** Windows per remote that asked for state; shared with the IPC layer, which records them first. */
  readonly subscriptions: Map<string, Set<number>>
  /** The server endpoints each window last pushed. */
  readonly servers: Map<number, readonly ExtensionEndpoint[]>
  readonly restart: (handoff?: () => void | Promise<void>) => Promise<void>
  readonly log: (message: string, data: Record<string, unknown>) => void
  /** Extension logs at their own level. */
  readonly write: (level: "debug" | "info" | "warn" | "error", message: string, data: Record<string, unknown>) => void
}) {
  const local = builtins.filter((definition) => !definition.os || definition.os.includes(os))
  const manager = createManager(
    input.db,
    (id) => id.startsWith("opencode") || builtins.some((definition) => definition.id === id),
  )
  const surfaces = createSurfaces()
  const entries = new Map<string, Entry>()
  const services = new Map<string, { readonly extension: string; readonly impl: unknown }>()
  const remotes = new Map<string, Provider>()
  const active = new Map<string, Instance>()
  // One serialized lifecycle per extension: each operation starts after the previous one fully settled.
  const queues = new Map<string, Promise<void>>()
  // Each extension's current generation. Stopping aborts it, so the activations queued or running under it
  // wind down at once; operations queued afterwards run under a fresh generation.
  const generations = new Map<string, AbortController>()
  const errors = new Map<string, string>()
  const reloads = new Map<string, number>()
  const closed = new Set<(win: BrowserWindow) => void>()
  const status = { sequence: 0, disposed: false, menubarQueued: false }

  const broadcast = (event: DesktopEvent) => getMainWindows().forEach((win) => emitIpcEvent(win.webContents, event))
  const changed = () => broadcast(new ExtensionsChanged({ list: installed() }))

  const subscribers = (remote: string, window?: number) => {
    const ids = input.subscriptions.get(remote)
    if (!ids) return []
    return [...ids]
      .filter((id) => window === undefined || id === window)
      .flatMap((id) => {
        const win = BrowserWindow.fromId(id)
        if (win && !win.isDestroyed()) return [win]
        ids.delete(id)
        return []
      })
  }

  const pushState = (remote: string, provider: Provider, window?: number) => {
    const schema = provider.spec.state
    const stateOf = provider.state
    if (!schema || !stateOf) return
    subscribers(remote, window).forEach((win) => {
      const encoded = Schema.encodeUnknownExit(schema)(stateOf(win.id))
      if (Exit.isFailure(encoded))
        return input.log("extension state encoding failed", { remote, cause: String(encoded.cause) })
      emitIpcEvent(win.webContents, new ExtensionState({ remote, state: encoded.value }))
    })
  }

  const menubarItems = () => {
    const items = [...entries.values()].flatMap((entry) => {
      if (entry.point !== Menubar.id) return []
      const item = read(entry)
      return isMenubar(item) ? [{ id: `${entry.extension}.${item.id}`, extension: entry.extension, item }] : []
    })
    const published = new Set(items.map((item) => item.id))
    // `after` names a sibling from the same extension by its local id, or a built-in item.
    return items.map((entry) => {
      const after = entry.item.after
      const sibling = `${entry.extension}.${after}`
      return { ...entry, after: after === undefined ? undefined : published.has(sibling) ? sibling : after }
    })
  }

  const publishMenubar = () => {
    status.menubarQueued = false
    if (status.disposed) return
    refreshMenu()
    broadcast(new ExtensionMenubarChanged({ items: menubar() }))
  }
  const scheduleMenubar = () => {
    if (status.menubarQueued) return
    status.menubarQueued = true
    queueMicrotask(publishMenubar)
  }

  const menubar = (): BridgeMenubarItem[] =>
    menubarItems().map((entry) => ({
      menu: entry.item.menu,
      id: entry.id,
      label: entry.item.label,
      ...(entry.after === undefined ? {} : { after: entry.after }),
      enabled: entry.item.enabled?.() ?? true,
    }))

  const server = (id: string): MainServer | undefined => {
    const sidecar = SidecarCredentials.get()
    // The app's own server is known here first-hand; the renderer never holds its credential.
    if (id === "sidecar") {
      if (!sidecar) return undefined
      const authorization = SidecarCredentials.authorization(sidecar, sidecar.url)
      return { id, url: sidecar.url, headers: authorization ? { authorization } : {}, local: true }
    }
    const endpoint = [...input.servers]
      .reverse()
      .flatMap(([window, list]) => {
        if (BrowserWindow.fromId(window)) return list
        input.servers.delete(window)
        return []
      })
      .find((item) => item.id === id)
    if (!endpoint) return undefined
    const authorization = endpoint.password
      ? `Basic ${Buffer.from(`${endpoint.username ?? "opencode"}:${endpoint.password}`).toString("base64")}`
      : SidecarCredentials.authorization(sidecar, endpoint.url)
    return {
      id,
      url: endpoint.url,
      headers: authorization ? { authorization } : {},
      local: !!sidecar && URL.canParse(endpoint.url) && new URL(endpoint.url).origin === sidecar.url,
      ...(endpoint.username === undefined ? {} : { username: endpoint.username }),
      ...(endpoint.password === undefined ? {} : { password: endpoint.password }),
    }
  }

  const mainApp: MainApp = {
    version: VERSION,
    channel: CHANNEL,
    packaged: app.isPackaged,
    server,
    restart: input.restart,
    log: (level, message, data) => input.write(level, message, data ?? {}),
  }

  const loader = (id: string): (() => Promise<Loaded>) | undefined => {
    const builtin = local.find((definition) => definition.id === id)
    if (builtin) {
      const main = builtin.main
      if (!main) return undefined
      return () => main().then((module) => ({ setup: module.default, i18n: builtin.i18n }))
    }
    const manifest = manager.installed().find((item) => item.id === id)?.manifest
    const entry = manifest?.main
    if (!manifest || !entry) return undefined
    return () => {
      const source = manager.file(id, entry)
      if (!source) return Promise.reject(new ExtensionError("invalidManifest"))
      return evaluateMain(source.toString("utf8"), manifest.imports.main ?? [])
    }
  }

  const resolveMessages = async (catalog?: Catalog): Promise<Messages> => {
    const english = catalog?.en ?? {}
    const locale = nativeLocale()
    const source = locale === "en" ? undefined : catalog?.[locale]
    if (!source) return english
    const loaded = typeof source === "function" ? (await source()).default : source
    return { ...english, ...loaded }
  }

  const fail = (id: string, error: unknown) => {
    errors.set(id, error instanceof Error ? error.message : String(error))
    input.log("extension failed", { id, error })
    changed()
    return undefined
  }

  const createInstance = (id: string, catalog: Catalog | undefined): Instance => {
    const controller = new AbortController()
    // The host's record of what the instance contributed; the host withdraws it the moment disposal starts.
    const contributions = new Set<() => void>()
    // The extension's own cleanups; they run after withdrawal, under a timeout.
    const cleanups = new Set<Cleanup>()
    // Cleanups registered after disposal started, such as the one a late setup returns.
    const late = new Set<Promise<void>>()
    const clients = new WeakMap<Provider, unknown>()
    // Owns this instance's native surfaces, so releasing them never touches a replacement's.
    const owner = {}
    const lifecycle: { setup: Promise<unknown>; disposed?: Promise<void> } = { setup: Promise.resolve() }
    const run = (fn: Cleanup) =>
      Promise.resolve()
        .then(fn)
        .then(
          () => undefined,
          (error: unknown) => input.log("extension cleanup failed", { id, error }),
        )
    const withdraw = (fn: () => void) => {
      // Host bookkeeping does not throw by design; isolating it keeps one failure from leaving the rest behind.
      try {
        fn()
      } catch (error) {
        input.log("extension withdrawal failed", { id, error })
      }
    }
    const contribute = (fn: () => void): Cleanup => {
      if (controller.signal.aborted) {
        withdraw(fn)
        return () => {}
      }
      const remove = () => {
        if (contributions.delete(remove)) fn()
      }
      contributions.add(remove)
      return remove
    }
    const own = (fn: Cleanup): Cleanup => {
      // Registered after disposal started: it runs now, and disposal waits for it too.
      if (controller.signal.aborted) {
        late.add(run(fn))
        return () => {}
      }
      const cleanup = () => {
        if (cleanups.delete(cleanup)) return fn()
      }
      cleanups.add(cleanup)
      return cleanup
    }

    const hosts = new Map<string, unknown>([
      [
        Windows.id,
        {
          get: (window) => getMainWindows().find((win) => win.id === window),
          list: getMainWindows,
          focused: () => getLastFocusedWindow() ?? undefined,
          on: (event, handler) => {
            if (event === "open") return contribute(onMainWindow(handler))
            closed.add(handler)
            return contribute(() => {
              closed.delete(handler)
            })
          },
        } satisfies Windows,
      ],
      [
        Surfaces.id,
        {
          create: (view, win) => {
            const surface = surfaces.create(owner, view, win)
            // Created by a setup that outlived its instance: taken down at once, like any late contribution.
            if (controller.signal.aborted) withdraw(surface.dispose)
            return surface
          },
        } satisfies Surfaces,
      ],
      [MainStorage.id, createMainStorage(input.state, id)],
      [Cli.id, input.cli],
      [MainApp.id, mainApp],
    ])

    function add<T>(point: Point<T>, item: T | (() => T | undefined)): Cleanup {
      if (controller.signal.aborted) return () => {}
      const key = `${id}/${++status.sequence}`
      entries.set(key, { point: point.id, extension: id, value: item })
      if (point.id === Menubar.id) scheduleMenubar()
      return contribute(() => {
        if (entries.delete(key) && point.id === Menubar.id) scheduleMenubar()
      })
    }

    function list<T>(point: Point<T>): readonly T[] {
      // Items were added through the same typed point, so they are that point's type.
      return [...entries.values()].flatMap((entry) => {
        if (entry.point !== point.id) return []
        const value = read(entry)
        return value === undefined ? [] : [value as T]
      })
    }

    function provide<T>(token: Service<T>, impl: T): Cleanup
    function provide<S extends RemoteSpec>(token: Remote<S>, impl: RemoteImpl<S>): Provided<S>
    function provide(token: Service<unknown> | Remote, impl: unknown): unknown {
      if (token.kind === "service") {
        if (controller.signal.aborted) return () => {}
        const entry = { extension: id, impl }
        services.set(token.id, entry)
        return contribute(() => {
          if (services.get(token.id) === entry) services.delete(token.id)
        })
      }
      return provideRemote(token, impl)
    }

    const provideRemote = (token: Remote, impl: unknown): Provided<RemoteSpec> => {
      const remote = token.id
      const current = remotes.get(remote)
      if (current && current.extension !== id)
        throw new Error(`Remote "${remote}" is already provided by ${current.extension}`)
      const methods = new Map(
        Object.keys(token.spec.methods).map((name) => {
          const method = Predicate.hasProperty(impl, name) ? impl[name] : undefined
          if (!isMethod(method)) throw new Error(`Remote "${remote}" is missing method "${name}"`)
          return [name, (value: unknown, caller: Caller) => method.call(impl, value, caller)] as const
        }),
      )
      const stateOf = Predicate.hasProperty(impl, "state") ? impl.state : undefined
      const provider: Provider = {
        extension: id,
        signal: controller.signal,
        spec: token.spec,
        methods,
        state: isState(stateOf) ? (window) => stateOf.call(impl, window) : undefined,
        listeners: new Set(),
      }
      const live = () => remotes.get(remote) === provider
      const dispose = controller.signal.aborted
        ? () => {}
        : contribute(() => {
            if (!live()) return
            remotes.delete(remote)
            broadcast(new ExtensionAvailable({ remote, available: false }))
          })
      if (!controller.signal.aborted) {
        remotes.set(remote, provider)
        broadcast(new ExtensionAvailable({ remote, available: true }))
        pushState(remote, provider)
      }
      return {
        changed(window) {
          if (live()) pushState(remote, provider, window)
        },
        emit(name, data, window) {
          if (!live()) return
          const schema = token.spec.events?.[name]
          if (!schema) throw new Error(`Remote "${remote}" has no event "${name}"`)
          provider.listeners.forEach((listener) => listener(name, data))
          const encoded = Schema.encodeUnknownExit(schema)(data)
          if (Exit.isFailure(encoded))
            return input.log("extension event encoding failed", { remote, name, cause: String(encoded.cause) })
          const event = new ExtensionEvent({ remote, name, data: encoded.value })
          if (window === undefined) return broadcast(event)
          const win = BrowserWindow.fromId(window)
          if (win && !win.isDestroyed()) emitIpcEvent(win.webContents, event)
        },
        dispose,
      }
    }

    function use<T>(token: Host<T>): T
    function use<T>(token: Service<T>): Accessor<T | undefined>
    function use<S extends RemoteSpec>(token: Remote<S>): Accessor<RemoteClient<S> | undefined>
    function use(token: Host<unknown> | Service<unknown> | Remote): unknown {
      if (token.kind === "host") {
        if (!hosts.has(token.id)) throw new Error(`Host service "${token.id}" is unavailable in the main process`)
        return hosts.get(token.id)
      }
      if (token.kind === "service") return () => services.get(token.id)?.impl
      return () => {
        const provider = remotes.get(token.id)
        if (!provider) return undefined
        const cached = clients.get(provider)
        if (cached) return cached
        const created = client(token.id, provider)
        clients.set(provider, created)
        return created
      }
    }

    // Main-to-main calls skip the codecs: both sides already hold decoded values. They carry no window.
    const client = (remote: string, provider: Provider) => ({
      ...Object.fromEntries(
        [...provider.methods].map(([name, method]) => [
          name,
          async (value: unknown, options?: { readonly signal?: AbortSignal }) => {
            // A client kept past its provider's disposal reaches nothing.
            if (remotes.get(remote) !== provider) throw new ExtensionError("unavailable")
            return method(value, {
              window: 0,
              signal: AbortSignal.any([
                controller.signal,
                provider.signal,
                ...(options?.signal ? [options.signal] : []),
              ]),
            })
          },
        ]),
      ),
      state: () => provider.state?.(0),
      on: (name: string, listener: (data: unknown) => void) => {
        const handler = (event: string, data: unknown) => {
          if (event === name) listener(data)
        }
        provider.listeners.add(handler)
        return contribute(() => {
          provider.listeners.delete(handler)
        })
      },
    })

    const instance: Instance = {
      catalog,
      messages: catalog?.en ?? {},
      context: {
        id,
        signal: controller.signal,
        cleanup: own,
        add,
        list,
        provide,
        use,
        t: (key: string, params?: Params) =>
          formatNativeTemplate(instance.messages[key] ?? nativeMessage(key) ?? key, params),
        plural: (key: string, count: number, params?: Params) => {
          const category = nativePluralCategory(count)
          const template =
            instance.messages[`${key}.${category}`] ??
            instance.messages[`${key}.other`] ??
            nativeMessage(`${key}.${category}`) ??
            nativeMessage(`${key}.other`) ??
            key
          return formatNativeTemplate(template, { ...params, count })
        },
      },
      start(setup) {
        const outcome = Promise.resolve()
          .then(() => setup(instance.context))
          .then(
            (cleanup): Outcome => {
              // A setup that settles after disposal started has its cleanup run now; disposal waits for it.
              if (typeof cleanup === "function") own(cleanup)
              return { ok: true }
            },
            (error: unknown): Outcome => ({ ok: false, error }),
          )
        lifecycle.setup = outcome
        return outcome
      },
      dispose() {
        if (lifecycle.disposed) return lifecycle.disposed
        controller.abort()
        // The host withdraws first and synchronously: a disposed instance is unreachable even if a cleanup hangs.
        ;[...contributions].reverse().forEach(withdraw)
        withdraw(() => surfaces.releaseOwner(owner))
        const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined }
        const deadline = new Promise<void>((resolve) => {
          timer.id = setTimeout(() => {
            input.log("extension cleanup timed out", { id })
            resolve()
          }, CLEANUP_TIMEOUT_MS)
        })
        // Cleanups run in reverse order; past the deadline the rest start without waiting, so a hung one
        // holds up neither the others nor the extension's lifecycle.
        const released = [...cleanups]
          .reverse()
          .reduce(
            (chain: Promise<unknown>, cleanup) => chain.then(() => Promise.race([run(cleanup), deadline])),
            Promise.resolve(),
          )
        // A setup still running settles, and the cleanups it registers late run, before the next lifecycle step.
        const settled = Promise.race([lifecycle.setup.then(() => Promise.all(late)), deadline])
        lifecycle.disposed = Promise.all([released, settled]).then(() => clearTimeout(timer.id))
        return lifecycle.disposed
      },
    }
    return instance
  }

  // The caller sees the step's own outcome; the queue only waits for it to settle, so a failed step never
  // stalls the steps behind it.
  const enqueue = (id: string, task: () => Promise<unknown>) => {
    const step = (queues.get(id) ?? Promise.resolve()).then(task).then(() => undefined)
    const tail: Promise<void> = step
      .catch(() => undefined)
      .finally(() => {
        if (queues.get(id) === tail) queues.delete(id)
      })
    queues.set(id, tail)
    return step
  }

  const generation = (id: string) => {
    const current = generations.get(id)
    if (current) return current.signal
    const created = new AbortController()
    generations.set(id, created)
    return created.signal
  }

  const activate = (id: string) => {
    const signal = generation(id)
    return enqueue(id, () => launch(id, signal))
  }

  const launch = async (id: string, signal: AbortSignal) => {
    const load = loader(id)
    const current = () => !signal.aborted && manager.enabled(id) && !status.disposed
    if (!load || active.has(id) || !current()) return
    errors.delete(id)
    const loaded = await until(
      signal,
      load().catch((error: unknown) => (current() ? fail(id, error) : undefined)),
    )
    // Stopped, disabled, or quitting while the code loaded: drop it, it may belong to an older revision.
    if (!loaded || active.has(id) || !current()) return
    const instance = createInstance(id, loaded.i18n)
    active.set(id, instance)
    instance.messages =
      (await until(
        signal,
        resolveMessages(loaded.i18n).catch(() => instance.messages),
      )) ?? instance.messages
    // Stopping removed the instance and began disposing it; its setup never runs.
    if (!current()) {
      if (active.get(id) === instance) active.delete(id)
      return instance.dispose()
    }
    // A stop during setup settles this step once the disposal has, however long setup takes.
    const outcome = await Promise.race([instance.start(loaded.setup), aborted(signal).then(() => instance.dispose())])
    if (!outcome || outcome.ok || active.get(id) !== instance) return
    fail(id, outcome.error)
    active.delete(id)
    await instance.dispose()
  }

  /**
   * Stops the extension at once and queues its teardown: activations queued before it go stale, the instance
   * withdraws everything it contributed now, and the queue moves on only after its disposal settled. `after`
   * runs inside the queue once the teardown finished.
   */
  const deactivate = (id: string, after?: () => void) => {
    generations.get(id)?.abort()
    generations.delete(id)
    const instance = active.get(id)
    active.delete(id)
    void instance?.dispose()
    return enqueue(id, async () => {
      await instance?.dispose()
      after?.()
    })
  }

  const known = (id: string) =>
    local.some((definition) => definition.id === id) || manager.installed().some((item) => item.id === id)

  const installed = (): ExtensionInstalled[] => [
    ...local.map((definition) => ({
      id: definition.id,
      // Built-ins are named by the renderer's own copy.
      name: definition.id,
      version: VERSION,
      builtin: true,
      enabled: manager.enabled(definition.id),
      ...revision(reloads.get(definition.id)?.toString()),
      ...failure(errors.get(definition.id)),
    })),
    ...manager.installed().map((item) => ({
      id: item.id,
      name: item.manifest?.name ?? item.id,
      version: item.manifest?.version ?? "",
      builtin: false,
      enabled: item.enabled,
      ...revision(item.revision),
      ...failure(item.manifest ? errors.get(item.id) : "invalidManifest"),
    })),
  ]

  const wire = (win: BrowserWindow) => {
    const window = win.id
    const forget = () => input.subscriptions.forEach((ids) => ids.delete(window))
    win.webContents.on(
      "did-start-navigation",
      (event: Electron.Event<{ isMainFrame: boolean; isSameDocument: boolean }>) => {
        if (!event.isMainFrame || event.isSameDocument) return
        // The renderer is reloading: it lays surfaces out and subscribes again once it is back.
        surfaces.reset(window)
        forget()
      },
    )
    win.once("closed", () => {
      surfaces.releaseWindow(window)
      forget()
      input.servers.delete(window)
      closed.forEach((listener) => listener(win))
    })
  }
  getMainWindows().forEach(wire)
  const stopWindows = onMainWindow(wire)

  const stopLocale = onNativeTranslations(() => {
    const locale = nativeLocale()
    void Promise.all(
      [...active.values()].map(async (instance) => {
        const messages = await resolveMessages(instance.catalog).catch(() => instance.catalog?.en ?? {})
        if (nativeLocale() === locale) instance.messages = messages
      }),
    ).then(scheduleMenubar)
  })

  setMenubarProvider(() =>
    menubarItems().map((entry) => ({
      menu: entry.item.menu,
      id: entry.id,
      label: entry.item.label,
      after: entry.after,
      enabled: () => entry.item.enabled?.() ?? true,
      run: () => entry.item.run(getLastFocusedWindow() ?? undefined),
    })),
  )

  return {
    /** Activates every enabled main extension. The app calls this once its first window is up. */
    async start() {
      const ids = [...local.map((definition) => definition.id), ...manager.installed().map((item) => item.id)]
      await Promise.all(ids.map(activate))
    },
    /** Activates the extension a remote belongs to ahead of `start`. Remote ids start with their extension's id. */
    demand(remote: string) {
      if (remotes.has(remote)) return
      const id = [...local.map((definition) => definition.id), ...manager.installed().map((item) => item.id)].find(
        (id) => remote === id || remote.startsWith(`${id}.`),
      )
      if (id) void activate(id)
    },
    snapshot(remote: string, window: number): { available: boolean; state?: unknown } {
      const provider = remotes.get(remote)
      if (!provider) return { available: false }
      const schema = provider.spec.state
      const stateOf = provider.state
      if (!schema || !stateOf) return { available: true }
      return { available: true, state: Schema.encodeUnknownSync(schema)(stateOf(window)) }
    },
    async call(
      request: { readonly remote: string; readonly method: string; readonly input?: unknown },
      caller: Caller,
    ) {
      const provider = remotes.get(request.remote)
      if (!provider) throw new ExtensionError("unavailable")
      const method = provider.methods.get(request.method)
      const spec = method ? provider.spec.methods[request.method] : undefined
      if (!method || !spec) throw new ExtensionError("method")
      const value = spec.input
        ? await Schema.decodeUnknownPromise(spec.input)(request.input).catch((error: unknown) => {
            throw new ExtensionError("input", { cause: error, message: String(error) })
          })
        : undefined
      // Withdrawn while the input decoded: the disposed instance is not called.
      if (remotes.get(request.remote) !== provider) throw new ExtensionError("unavailable")
      const output = await method(value, {
        window: caller.window,
        signal: AbortSignal.any([caller.signal, provider.signal]),
      })
      if (!spec.output) return undefined
      return Schema.encodeUnknownPromise(spec.output)(output).catch((error: unknown) => {
        throw new ExtensionError("output", { cause: error, message: String(error) })
      })
    },
    surface: (window: number, id: string, layout?: BridgeLayout) => surfaces.layout(window, id, layout),
    capture: (window: number, id: string) =>
      surfaces.capture(window, id).then((image) => (image ? new Uint8Array(image.toJPEG(90)) : undefined)),
    menubar,
    runMenubar(window: number, id: string) {
      const entry = menubarItems().find((item) => item.id === id)
      if (!entry || !(entry.item.enabled?.() ?? true)) return
      entry.item.run(BrowserWindow.fromId(window) ?? undefined)
    },
    list: installed,
    async enable(id: string) {
      if (!known(id)) throw new ExtensionError("notFound")
      manager.setEnabled(id, true)
      changed()
      await activate(id)
    },
    async disable(id: string) {
      if (!known(id)) throw new ExtensionError("notFound")
      manager.setEnabled(id, false)
      await deactivate(id)
      changed()
    },
    async reload(id: string) {
      if (!known(id)) throw new ExtensionError("notFound")
      if (local.some((definition) => definition.id === id)) reloads.set(id, (reloads.get(id) ?? 0) + 1)
      else manager.bump(id)
      errors.delete(id)
      await deactivate(id)
      changed()
      await activate(id)
    },
    async install(source: Uint8Array | string) {
      const manifest = await manager.install(source)
      errors.delete(manifest.id)
      await deactivate(manifest.id)
      changed()
      await activate(manifest.id)
    },
    async remove(id: string) {
      if (local.some((definition) => definition.id === id)) throw new ExtensionError("builtin")
      if (!known(id)) throw new ExtensionError("notFound")
      // Inside the queue, so an activation queued meanwhile finds the extension already gone.
      await deactivate(id, () => {
        manager.remove(id)
        input.state.clear(namespace(id))
        errors.delete(id)
      })
      changed()
    },
    source(id: string) {
      const manifest = manager.installed().find((item) => item.id === id)?.manifest
      if (!manifest) throw new ExtensionError("notFound")
      const file = manager.file(id, manifest.renderer)
      if (!file) throw new ExtensionError("notFound")
      return file.toString("utf8")
    },
    /** Disposes every main extension; quitting awaits their async cleanups. */
    async dispose() {
      status.disposed = true
      stopWindows()
      stopLocale()
      // Every extension with an instance or a queued step stops; quitting waits for each lifecycle to settle.
      await Promise.all([...new Set([...active.keys(), ...queues.keys()])].map((id) => deactivate(id)))
    },
  }
}

/** The promise's value, or undefined as soon as the signal aborts; the promise itself keeps running. */
function until<T>(signal: AbortSignal, promise: Promise<T>) {
  return Promise.race([promise, aborted(signal)])
}

function aborted(signal: AbortSignal) {
  return new Promise<undefined>((resolve) => {
    if (signal.aborted) return resolve(undefined)
    signal.addEventListener("abort", () => resolve(undefined), { once: true })
  })
}

function read(entry: Entry) {
  return isGetter(entry.value) ? entry.value() : entry.value
}

function isGetter(value: unknown): value is () => unknown {
  return typeof value === "function"
}

function isMethod(value: unknown): value is Method {
  return typeof value === "function"
}

function isState(value: unknown): value is (window: number) => unknown {
  return typeof value === "function"
}

function isMenubar(value: unknown): value is Menubar {
  return (
    Predicate.hasProperty(value, "id") &&
    Predicate.hasProperty(value, "menu") &&
    Predicate.hasProperty(value, "label") &&
    Predicate.hasProperty(value, "run") &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.run === "function"
  )
}

function revision(value: string | undefined) {
  return value === undefined ? {} : { revision: value }
}

function failure(value: string | undefined) {
  return value === undefined ? {} : { error: value }
}
