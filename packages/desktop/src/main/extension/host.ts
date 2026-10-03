import { app, BrowserWindow } from "electron"
import { builtins } from "@opencode/gui-extensions/main"
import type { BridgeLayout, BridgeMenubarItem } from "@opencode/gui-extensions/sdk/bridge"
import {
  MenubarItem,
  type BaseContext,
  type Build,
  type Caller,
  type Catalog,
  type Cleanup,
  type Cli,
  type Definition,
  type Embeds,
  type Ipc,
  type IpcImpl,
  type IpcProvider,
  type IpcSpec,
  type Lifecycle,
  type Log,
  type MainContext,
  type MainSetup,
  type Messages,
  type OS,
  type Params,
  type Point,
  type ServerEndpoint,
  type ServerEndpoints,
  type Windows,
} from "@opencode/gui-extensions/sdk/main"
import { Exit, Match, Predicate, Schema } from "effect"
import type { ExtensionEndpoint, ExtensionInstalled } from "../../shared/ipc-rpc/extensions"
import {
  ExtensionAvailable,
  ExtensionEvent,
  ExtensionMenubarItemsChanged,
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
import { createLifecycle, type ErrorLog, type Instance, type Revision } from "./lifecycle"
import { createManager } from "./manager"
import { evaluateMain } from "./module"
import { getStore } from "../storage/store"
import { createStorage, namespace } from "./storage"
import { createEmbeds } from "./embeds"

export type ExtensionHost = ReturnType<typeof createHost>

type Loaded = { readonly setup: MainSetup; readonly i18n?: Catalog; readonly stores?: Definition["stores"] }

/** An Ipc method with its spec erased: Ipcs of every spec share one table, and `call` runs the spec's codecs. */
type Method = IpcImpl<IpcSpec>[string]

/** A value one of an Ipc's schemas governs, erased like the methods that take it. */
type Value = Parameters<Method>[0]

type Provider = {
  readonly extension: string
  readonly signal: AbortSignal
  readonly spec: IpcSpec
  readonly methods: ReadonlyMap<string, Method>
  readonly state?: (window: number) => Value
}

/** The APIs a main context exposes as properties, as each instance creates them on first read. */
type HostApis = {
  -readonly [K in Exclude<keyof MainContext, keyof BaseContext | "scope" | "provide">]?: MainContext[K]
}

/** A contribution as `add` stores it, with its point's item type erased; `list` restores it. */
type Item = Parameters<MainContext["add"]>[1]

type Entry = { readonly point: string; readonly extension: string; readonly value: Item }

type Translation = { readonly catalog?: Catalog; messages: Messages }

const os = Match.value(process.platform).pipe(
  Match.when("darwin", () => "macos" as const),
  Match.when("win32", () => "windows" as const),
  Match.orElse(() => "linux" as const),
) satisfies OS

/**
 * The main-process GUI extension host. Every main extension is an app-scoped singleton; windows
 * reach its Ipcs over the bridge and main scopes state and events by `caller.window`.
 */
export function createHost(input: {
  readonly db: Database
  readonly state: StateStore
  readonly cli: Cli
  /** Windows per Ipc that asked for state; shared with the IPC layer, which records them first. */
  readonly subscriptions: Map<string, Set<number>>
  /** The server endpoints each window last pushed. */
  readonly servers: Map<number, readonly ExtensionEndpoint[]>
  readonly restart: (handoff?: () => void | Promise<void>) => Promise<void>
  readonly log: ErrorLog
  /** Extension logs at their own level. */
  readonly write: <Data extends Readonly<Record<string, unknown>>>(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data: Data,
  ) => void
}) {
  const definitions: readonly Definition[] = builtins
  const local = definitions.filter((definition) => !definition.os || definition.os.includes(os))

  const manager = createManager(
    input.db,
    (id) => id.startsWith("opencode") || definitions.some((definition) => definition.id === id),
  )

  const embeds = createEmbeds()
  const entries = new Map<string, Entry>()
  const ipcs = new Map<string, Provider>()
  // Each live instance's catalog and messages, so a locale change reaches them.
  const translations = new Set<Translation>()
  const reloads = new Map<string, number>()
  const closed = new Set<(win: BrowserWindow) => void>()
  const status = { sequence: 0, disposed: false, menubarQueued: false }

  const broadcast = (event: DesktopEvent) => getMainWindows().forEach((win) => emitIpcEvent(win.webContents, event))
  const changed = () => broadcast(new ExtensionsChanged({ list: installed() }))

  const subscribers = (ipc: string, window?: number) => {
    const ids = input.subscriptions.get(ipc)

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

  const pushState = (ipc: string, provider: Provider, window?: number) => {
    const schema = provider.spec.state
    const stateOf = provider.state

    if (!schema || !stateOf) return
    subscribers(ipc, window).forEach((win) => {
      const encoded = Schema.encodeUnknownExit(schema)(stateOf(win.id))

      if (Exit.isFailure(encoded))
        return input.log("extension state encoding failed", { ipc, cause: String(encoded.cause) })
      emitIpcEvent(win.webContents, new ExtensionState({ ipc, state: encoded.value }))
    })
  }

  const menubarItems = () => {
    const items = [...entries.values()].flatMap((entry) => {
      if (entry.point !== MenubarItem.id) return []
      const item = read(entry)

      return isMenubarItem(item) ? [{ id: `${entry.extension}.${item.id}`, extension: entry.extension, item }] : []
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
    broadcast(new ExtensionMenubarItemsChanged({ items: listMenubarItems() }))
  }

  const scheduleMenubar = () => {
    if (status.menubarQueued) return
    status.menubarQueued = true
    queueMicrotask(publishMenubar)
  }

  const listMenubarItems = (): BridgeMenubarItem[] =>
    menubarItems().map((entry) => {
      const item = {
        menu: entry.item.menu,
        id: entry.id,
        label: entry.item.label,
        enabled: entry.item.enabled?.() ?? true,
      }

      // The IPC schema takes `after` as an optional key: it is left out rather than undefined.
      return entry.after === undefined ? item : { ...item, after: entry.after }
    })

  const server = (id: string): ServerEndpoint | undefined => {
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
      username: endpoint.username,
      password: endpoint.password,
    }
  }

  const build = { version: VERSION, channel: CHANNEL, platform: "desktop", packaged: app.isPackaged } satisfies Build

  const serverEndpoints = { get: server } satisfies ServerEndpoints

  const desktopLog = {
    write: (level, message, data) => input.write(level, message, data ?? {}),
  } satisfies Log

  const lifecycle = createLifecycle({
    loader: (id) => loader(id),
    enabled: (id) => manager.enabled(id),
    changed: () => changed(),
    log: input.log,
  })

  const loader = (id: string): (() => Promise<Revision>) | undefined => {
    const builtin = local.find((definition) => definition.id === id)

    if (builtin) {
      const main = builtin.main

      if (!main) return undefined

      return () =>
        main().then((module) =>
          // SAFETY: a built-in's main entry exports a `MainSetup`, whose context this host builds.
          prepare(id, { setup: module.default as MainSetup, i18n: builtin.i18n, stores: builtin.stores }),
        )
    }

    const manifest = manager.installed().find((item) => item.id === id)?.manifest
    const entry = manifest?.main

    if (!manifest || !entry) return undefined

    return () => {
      const source = manager.file(id, entry)

      if (!source) return Promise.reject(new ExtensionError("invalidManifest"))

      return evaluateMain(source.toString("utf8"), manifest.imports.main ?? []).then((loaded) => prepare(id, loaded))
    }
  }

  const resolveMessages = async (catalog?: Catalog): Promise<Messages> => {
    const english = catalog?.en ?? {}
    const locale = nativeLocale()
    const source = locale === "en" ? undefined : catalog?.[locale]

    if (!source) return english
    const loaded = Predicate.isFunction(source) ? (await source()).default : source

    return { ...english, ...loaded }
  }

  /** A loaded revision of the extension's main code; each instance of it gets its own setup context. */
  const prepare =
    (id: string, loaded: Loaded): Revision =>
    (instance) =>
      createContext(id, loaded, instance)

  const createContext = (id: string, loaded: Loaded, instance: Instance): ReturnType<Revision> => {
    const signal = instance.scope.signal
    const contribute = instance.contribute
    // Registered first, so it runs last: the instance's embeds go after everything else it contributed. They are
    // owned by the instance, so releasing them never touches a replacement's.
    contribute(() => embeds.releaseOwner(instance))
    const translation: Translation = { catalog: loaded.i18n, messages: loaded.i18n?.en ?? {} }
    translations.add(translation)
    contribute(() => {
      translations.delete(translation)
    })
    // The instance's HostApis, each created on first read.
    const created: HostApis = {}

    function add<T>(point: Point<T>, item: T | (() => T | undefined)): Cleanup {
      if (signal.aborted) return () => {}

      const key = `${id}/${++status.sequence}`
      entries.set(key, { point: point.id, extension: id, value: item })

      if (point.id === MenubarItem.id) scheduleMenubar()

      return contribute(() => {
        if (entries.delete(key) && point.id === MenubarItem.id) scheduleMenubar()
      })
    }

    function list<T>(point: Point<T>): readonly T[] {
      return [...entries.values()].flatMap((entry) => {
        if (entry.point !== point.id) return []
        const value = read(entry)

        // SAFETY: only `add` stores entries, under the id of the typed point it was given, so this point's items are T.
        return value === undefined ? [] : [value as T]
      })
    }

    function provide<S extends IpcSpec>(token: Ipc<S>, impl: IpcImpl<S>): IpcProvider<S>
    function provide(token: Ipc, impl: IpcImpl<IpcSpec>): IpcProvider<IpcSpec> {
      // Installed extensions are plain JavaScript: a contract token here has no spec to serve.
      if (token.kind !== "ipc") throw new Error("Contracts are provided by an extension's renderer entry")

      const ipc = token.id
      const current = ipcs.get(ipc)

      if (current && current.extension !== id)
        throw new Error(`Ipc "${ipc}" is already provided by ${current.extension}`)

      const methods = new Map(
        Object.keys(token.spec.methods).map((name) => {
          const method = Predicate.hasProperty(impl, name) ? impl[name] : undefined

          if (!isMethod(method)) throw new Error(`Ipc "${ipc}" is missing method "${name}"`)

          return [name, (value: Value, caller: Caller) => method.call(impl, value, caller)] as const
        }),
      )

      const stateOf = Predicate.hasProperty(impl, "state") ? impl.state : undefined

      const provider: Provider = {
        extension: id,
        signal,
        spec: token.spec,
        methods,
        state: isState(stateOf) ? (window) => stateOf.call(impl, window) : undefined,
      }

      const live = () => ipcs.get(ipc) === provider

      const dispose = signal.aborted
        ? () => {}
        : contribute(() => {
            if (!live()) return
            ipcs.delete(ipc)
            broadcast(new ExtensionAvailable({ ipc, available: false }))
          })

      if (!signal.aborted) {
        ipcs.set(ipc, provider)
        broadcast(new ExtensionAvailable({ ipc, available: true }))
        pushState(ipc, provider)
      }

      return {
        changed(window) {
          if (live()) pushState(ipc, provider, window)
        },
        emit(name, data, window) {
          if (!live()) return
          const schema = token.spec.events?.[name]

          if (!schema) throw new Error(`Ipc "${ipc}" has no event "${name}"`)
          const encoded = Schema.encodeUnknownExit(schema)(data)

          if (Exit.isFailure(encoded))
            return input.log("extension event encoding failed", { ipc, name, cause: String(encoded.cause) })
          const event = new ExtensionEvent({ ipc, name, data: encoded.value })

          if (window === undefined) return broadcast(event)
          const win = BrowserWindow.fromId(window)

          if (win && !win.isDestroyed()) emitIpcEvent(win.webContents, event)
        },
        dispose,
      }
    }

    const storage = () => (created.storage ??= createStorage(input.state, getStore, id))

    const context: MainContext = {
      id,
      scope: instance.scope,
      // The declared main stores, opened on the first read; main storage reads synchronously, so they are loaded.
      get stores() {
        return (created.stores ??= Object.fromEntries(
          Object.entries(loaded.stores ?? {}).flatMap(([name, declaration]) =>
            declaration.scope === "main" ? [[name, storage().store(name, declaration)] as const] : [],
          ),
        ))
      },
      get storage() {
        return storage()
      },
      get log() {
        return desktopLog
      },
      get lifecycle() {
        return (created.lifecycle ??= {
          restart: (handoff, options) =>
            lifecycle.restart(options?.keep ?? instance.scope, () => input.restart(handoff)),
        } satisfies Lifecycle)
      },
      get build() {
        return build
      },
      get serverEndpoints() {
        return serverEndpoints
      },
      get windows() {
        return (created.windows ??= {
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
        } satisfies Windows)
      },
      get embeds() {
        return (created.embeds ??= {
          create: (view, win) => {
            const embed = embeds.create(instance, view, win)

            // Created by a setup that outlived its instance: taken down at once, like any late contribution.
            if (signal.aborted) contribute(embed.dispose)

            return embed
          },
        } satisfies Embeds)
      },
      get cli() {
        return input.cli
      },
      add,
      list,
      provide,
      t: (key: string, params?: Params) =>
        formatNativeTemplate(translation.messages[key] ?? nativeMessage(key) ?? key, params),
      plural: (key: string, count: number, params?: Params) => {
        const category = nativePluralCategory(count)

        const template =
          translation.messages[`${key}.${category}`] ??
          translation.messages[`${key}.other`] ??
          nativeMessage(`${key}.${category}`) ??
          nativeMessage(`${key}.other`) ??
          key

        return formatNativeTemplate(template, { ...params, count })
      },
    }

    return {
      ready: resolveMessages(loaded.i18n).then((messages) => {
        translation.messages = messages
      }),
      setup: () => loaded.setup(context),
    }
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
      ...failure(lifecycle.failure(definition.id)),
    })),
    ...manager.installed().map((item) => ({
      id: item.id,
      name: item.manifest?.name ?? item.id,
      version: item.manifest?.version ?? "",
      builtin: false,
      enabled: item.enabled,
      ...revision(item.revision),
      ...failure(item.manifest ? lifecycle.failure(item.id) : "invalidManifest"),
    })),
  ]

  const wire = (win: BrowserWindow) => {
    const window = win.id
    const forget = () => input.subscriptions.forEach((ids) => ids.delete(window))
    win.webContents.on(
      "did-start-navigation",
      (event: Electron.Event<{ isMainFrame: boolean; isSameDocument: boolean }>) => {
        if (!event.isMainFrame || event.isSameDocument) return
        // The renderer is reloading: it lays embeds out and subscribes again once it is back.
        embeds.reset(window)
        forget()
      },
    )
    win.once("closed", () => {
      embeds.releaseWindow(window)
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
      [...translations].map(async (translation) => {
        const messages = await resolveMessages(translation.catalog).catch(() => translation.catalog?.en ?? {})

        if (nativeLocale() === locale) translation.messages = messages
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
      await Promise.all(ids.map((id) => lifecycle.activate(id)))
    },
    /** Activates the extension an Ipc belongs to ahead of `start`. Ipc ids start with their extension's id. */
    demand(ipc: string) {
      if (ipcs.has(ipc)) return

      const id = [...local.map((definition) => definition.id), ...manager.installed().map((item) => item.id)].find(
        (id) => ipc === id || ipc.startsWith(`${id}.`),
      )

      if (id) void lifecycle.activate(id)
    },
    snapshot(ipc: string, window: number) {
      const provider = ipcs.get(ipc)

      if (!provider) return { available: false }
      const schema = provider.spec.state
      const stateOf = provider.state

      if (!schema || !stateOf) return { available: true }

      return { available: true, state: Schema.encodeUnknownSync(schema)(stateOf(window)) }
    },
    async call(request: { readonly ipc: string; readonly method: string; readonly input?: unknown }, caller: Caller) {
      const provider = ipcs.get(request.ipc)

      if (!provider) throw new ExtensionError("unavailable")
      const method = provider.methods.get(request.method)
      const spec = method ? provider.spec.methods[request.method] : undefined

      if (!method || !spec) throw new ExtensionError("method")

      const value = spec.input
        ? await Schema.decodeUnknownPromise(spec.input)(request.input).catch((cause: unknown) => {
            throw new ExtensionError("input", { cause, message: String(cause) })
          })
        : undefined

      // Withdrawn while the input decoded: the disposed instance is not called.
      if (ipcs.get(request.ipc) !== provider) throw new ExtensionError("unavailable")

      const output = await method(value, {
        window: caller.window,
        signal: AbortSignal.any([caller.signal, provider.signal]),
      })

      if (!spec.output) return undefined

      return Schema.encodeUnknownPromise(spec.output)(output).catch((cause: unknown) => {
        throw new ExtensionError("output", { cause, message: String(cause) })
      })
    },
    embed: (window: number, id: string, layout?: BridgeLayout) => embeds.layout(window, id, layout),
    capture: (window: number, id: string) =>
      embeds.capture(window, id).then((image) => (image ? new Uint8Array(image.toJPEG(90)) : undefined)),
    listMenubarItems,
    runMenubarItem(window: number, id: string) {
      const entry = menubarItems().find((item) => item.id === id)

      if (!entry || !(entry.item.enabled?.() ?? true)) return
      entry.item.run(BrowserWindow.fromId(window) ?? undefined)
    },
    list: installed,
    async enable(id: string) {
      if (!known(id)) throw new ExtensionError("notFound")
      manager.setEnabled(id, true)
      changed()
      await lifecycle.activate(id)
    },
    async disable(id: string) {
      if (!known(id)) throw new ExtensionError("notFound")
      manager.setEnabled(id, false)
      await lifecycle.deactivate(id)
      changed()
    },
    /** A development tool: packaged builds refuse it. A reload that fails keeps the last good revision running. */
    async reload(id: string) {
      if (!known(id)) throw new ExtensionError("notFound")

      if (local.some((definition) => definition.id === id)) reloads.set(id, (reloads.get(id) ?? 0) + 1)
      else manager.bump(id)
      await lifecycle.reload(id)
      changed()
    },
    async install(source: Uint8Array | string) {
      const manifest = await manager.install(source)
      lifecycle.forget(manifest.id)
      await lifecycle.deactivate(manifest.id)
      changed()
      await lifecycle.activate(manifest.id)
    },
    async remove(id: string) {
      if (local.some((definition) => definition.id === id)) throw new ExtensionError("builtin")

      if (!known(id)) throw new ExtensionError("notFound")
      // Inside the queue, so an activation queued meanwhile finds the extension already gone.
      await lifecycle.deactivate(id, () => {
        manager.remove(id)
        input.state.clear(namespace(id))
        lifecycle.forget(id)
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
    /** Disposes every main extension but one a restart handoff keeps; quitting awaits their async cleanups. */
    async dispose() {
      status.disposed = true
      stopWindows()
      stopLocale()
      // The menu is not rebuilt from here on (`publishMenubar`), so a kept extension's items stay in it.
      await lifecycle.dispose()
    },
  }
}

function read(entry: Entry) {
  return isGetter(entry.value) ? entry.value() : entry.value
}

// Installed extensions are plain JavaScript: these check the shapes the SDK types promise before the host relies on them.
function isGetter(value: Item): value is () => Item {
  return Predicate.isFunction(value)
}

function isMethod(value: unknown): value is Method {
  return Predicate.isFunction(value)
}

function isState(value: unknown): value is (window: number) => Value {
  return Predicate.isFunction(value)
}

function isMenubarItem(value: Item): value is MenubarItem {
  return (
    Predicate.hasProperty(value, "id") &&
    Predicate.hasProperty(value, "menu") &&
    Predicate.hasProperty(value, "label") &&
    Predicate.hasProperty(value, "run") &&
    Predicate.isString(value.id) &&
    Predicate.isString(value.label) &&
    Predicate.isFunction(value.run)
  )
}

function revision(value: string | undefined) {
  return value === undefined ? {} : { revision: value }
}

function failure(value: string | undefined) {
  return value === undefined ? {} : { error: value }
}
