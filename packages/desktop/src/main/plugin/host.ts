import { app, BrowserWindow } from "electron"
import { builtins } from "@opencode/gui-plugins/main"
import {
  pluginIdAvailable,
  runsOn,
  shipsPluginGui,
  type BridgeLayout,
  type BridgeMenubarItem,
  type Entry,
} from "@opencode/plugin/gui/host"
import {
  MenubarItem,
  type Plugin,
  type BaseContext,
  type App,
  type Caller,
  type Cleanup,
  type Cli,
  type Embeds,
  type Ipc,
  type IpcImpl,
  type IpcProvider,
  type IpcSpec,
  type Log,
  type MainContext,
  type Messages,
  type OS,
  type Params,
  type PluginOptions,
  type Registry,
  type ServerEndpoint,
  type ServerEndpoints,
  type Windows,
} from "@opencode/plugin/gui/main"
import type { BuiltinCatalog, BuiltinMainContext, Lifecycle } from "@opencode/plugin/gui/builtin"
import type { OpenCodeClient, PluginGuiBundle } from "@opencode/client"
import { Exit, Match, Predicate, Schema } from "effect"
import type { PluginEndpoint, PluginInstalled } from "../../shared/ipc-rpc/plugins"
import {
  PluginAvailable,
  PluginEvent,
  PluginMenubarItemsChanged,
  PluginGuisChanged,
  PluginState,
  PluginsChanged,
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
import { PluginError } from "./error"
import { createLifecycle, type ErrorLog, type Instance, type Revision } from "./lifecycle"
import { createManager } from "./manager"
import { evaluateMain } from "./module"
import { getStore } from "../storage/store"
import { createStorage } from "./storage"
import { createEmbeds } from "./embeds"

export type PluginHost = ReturnType<typeof createHost>

type Loaded = {
  readonly setup: Plugin.MainSetup
  readonly i18n?: BuiltinCatalog
  /** A plugin's options from `opencode.json`; built-ins have none. */
  readonly options?: PluginOptions
  /** The client of the server that runs a plugin, read each time; built-ins have none. */
  readonly client?: () => OpenCodeClient | undefined
}

/**
 * A plugin's `./gui-experimental` bundle as main read it, evaluated once per revision; a failed evaluation fails its
 * activation.
 */
type ListedPlugin = {
  readonly bundle: PluginGuiBundle
  readonly loaded:
    | { readonly ok: true; readonly value: Awaited<ReturnType<typeof evaluateMain>> }
    | { readonly ok: false; readonly cause: unknown }
}

/**
 * What main keeps of the plugin listing besides the plugins: the ids a built-in claims, the plugins with a server
 * part and those that export `./tui` (Extensions › Plugins tags those parts), and the follow of the server.
 */
type Inventory = {
  reserved: readonly string[]
  server: ReadonlySet<string>
  tui: ReadonlySet<string>
  /** Plugins whose `os` leaves out this system: listed in Extensions › Plugins, never run. */
  unsupported: ReadonlySet<string>
  /**
   * New plugins whose bundle main could not read, with why: listed in Extensions › Plugins until a listing reads them.
   */
  unreadable: ReadonlyMap<string, string>
  /** Aborts the current follow of the app's own server. */
  watch?: AbortController
  /** Stops following the server's connections. */
  stop?: () => void
}

const loadClient = () => import("@opencode/client")

/** The client of the app's own server, made once the client module loaded and again when the endpoint changes. */
type SidecarClient = {
  module?: Awaited<ReturnType<typeof loadClient>>
  key?: string
  client?: OpenCodeClient
  /** The client plugins read while the server is unreachable. */
  unavailable?: OpenCodeClient
}

/** An Ipc method with its spec erased: Ipcs of every spec share one table, and `call` runs the spec's codecs. */
type Method = IpcImpl<IpcSpec>[string]

/** A value one of an Ipc's schemas governs, erased like the methods that take it. */
type Value = Parameters<Method>[0]

type Provider = {
  readonly plugin: string
  readonly signal: AbortSignal
  readonly spec: IpcSpec
  readonly methods: ReadonlyMap<string, Method>
  readonly state?: (window: number) => Value
}

/** The APIs a main context exposes as properties, as each instance creates them on first read. */
type HostApis = {
  -readonly [K in Exclude<
    keyof BuiltinMainContext,
    keyof BaseContext | "onCleanup" | "provide"
  >]?: BuiltinMainContext[K]
}

/** A contribution as `add` stores it, with its registry's item type erased; `list` restores it. */
type Item = Parameters<MainContext["add"]>[1]

type Contribution = { readonly registry: string; readonly plugin: string; readonly value: Item }

type Translation = { readonly catalog?: BuiltinCatalog; messages: Messages }

const os = Match.value(process.platform).pipe(
  Match.when("darwin", () => "macos" as const),
  Match.when("win32", () => "windows" as const),
  Match.orElse(() => "linux" as const),
) satisfies OS

/**
 * The main-process GUI plugin host. Every main plugin is an app-scoped singleton; windows
 * reach its Ipcs over the bridge and main scopes state and events by `caller.window`.
 */
export function createHost(input: {
  readonly db: Database
  readonly state: StateStore
  readonly cli: Cli
  /** Windows per Ipc that asked for state; shared with the IPC layer, which records them first. */
  readonly subscriptions: Map<string, Set<number>>
  /** The server endpoints each window last pushed. */
  readonly servers: Map<number, readonly PluginEndpoint[]>
  readonly restart: (handoff?: () => void | Promise<void>) => Promise<void>
  readonly log: ErrorLog
  /** Plugin logs at their own level. */
  readonly write: <Data extends Readonly<Record<string, unknown>>>(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data: Data,
  ) => void
}) {
  const definitions: readonly Entry[] = builtins
  const local = definitions.filter((definition) => runsOn(definition, os))

  const manager = createManager(
    input.db,
    definitions.map((definition) => definition.id),
  )

  const embeds = createEmbeds()
  // Plugins on the app's own server that ship a `./gui-experimental` bundle, each at the bundle main last read and
  // runs. Main alone lists and reads them, from that server first-hand; windows load what main sends.
  const plugins = new Map<string, ListedPlugin>()

  const inventory: Inventory = {
    reserved: [],
    server: new Set(),
    tui: new Set(),
    unsupported: new Set(),
    unreadable: new Map(),
  }

  // The revision of each bundle that runs only on other systems, so a listing does not evaluate it again.
  const skipped = new Map<string, string>()
  const entries = new Map<string, Contribution>()
  const ipcs = new Map<string, Provider>()
  // Each live instance's catalog and messages, so a locale change reaches them.
  const translations = new Set<Translation>()
  const closed = new Set<(win: BrowserWindow) => void>()
  const status = { sequence: 0, disposed: false, menubarQueued: false, listing: false, relist: false }

  const broadcast = (event: DesktopEvent) => getMainWindows().forEach((win) => emitIpcEvent(win.webContents, event))
  const changed = () => broadcast(new PluginsChanged({ list: installed() }))

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
        return input.log("plugin state encoding failed", { ipc, cause: String(encoded.cause) })
      emitIpcEvent(win.webContents, new PluginState({ ipc, state: encoded.value }))
    })
  }

  const menubarItems = () => {
    const items = [...entries.values()].flatMap((entry) => {
      if (entry.registry !== MenubarItem.id) return []
      const item = read(entry)

      return isMenubarItem(item) ? [{ id: `${entry.plugin}.${item.id}`, plugin: entry.plugin, item }] : []
    })

    const published = new Set(items.map((item) => item.id))

    // `after` names a sibling from the same plugin by its local id, or a built-in item.
    return items.map((entry) => {
      const after = entry.item.after
      const sibling = `${entry.plugin}.${after}`

      return { ...entry, after: after === undefined ? undefined : published.has(sibling) ? sibling : after }
    })
  }

  const publishMenubar = () => {
    status.menubarQueued = false

    if (status.disposed) return
    refreshMenu()
    broadcast(new PluginMenubarItemsChanged({ items: listMenubarItems() }))
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

      return { id, url: sidecar.url, headers: authorization ? { authorization } : {}, sameMachine: true }
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
      ? `Basic ${Buffer.from(`opencode:${endpoint.password}`).toString("base64")}`
      : SidecarCredentials.authorization(sidecar, endpoint.url)

    return {
      id,
      url: endpoint.url,
      headers: authorization ? { authorization } : {},
      sameMachine: !!sidecar && URL.canParse(endpoint.url) && new URL(endpoint.url).origin === sidecar.url,
      password: endpoint.password,
    }
  }

  const about = {
    name: "opencode",
    version: VERSION,
    channel: CHANNEL,
    platform: "desktop",
    packaged: app.isPackaged,
  } satisfies App

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
      const main = builtin.mainEntry

      if (!main) return undefined

      return () =>
        main().then((module) =>
          // SAFETY: a built-in's main entry exports a `Plugin.MainSetup`, whose context this host builds.
          prepare(id, { setup: module.default as Plugin.MainSetup, i18n: builtin.i18n }),
        )
    }

    const plugin = plugins.get(id)

    if (!plugin) return undefined

    return async () => {
      if (!plugin.loaded.ok) throw plugin.loaded.cause

      return prepare(id, { ...plugin.loaded.value, options: plugin.bundle.options, client: sidecarClient })
    }
  }

  // The client of the app's own server, with the credential only main holds; a new one when its endpoint changes.
  const sidecar: SidecarClient = {}

  // The client a plugin reads while the app's own server is unreachable: every call rejects. Plugins from the config load
  // after the client module, so it is there for them; built-ins never read it.
  const unavailableClient = () => {
    if (!sidecar.module) throw new Error("The app's own server is unavailable")

    return (sidecar.unavailable ??= sidecar.module.OpenCode.make({
      baseUrl: "http://unavailable.invalid/",
      fetch: () => Promise.reject(new Error("The app's own server is unavailable")),
    }))
  }

  const sidecarClient = () => {
    const endpoint = server("sidecar")

    if (!endpoint || !sidecar.module) return undefined
    const key = JSON.stringify([endpoint.url, endpoint.headers])

    if (sidecar.key !== key)
      Object.assign(sidecar, {
        key,
        client: sidecar.module.OpenCode.make({ baseUrl: endpoint.url, headers: { ...endpoint.headers } }),
      })

    return sidecar.client
  }

  // Follows the app's own server, as the TUI does: lists its plugins on each connection and each `plugin.updated`.
  // Every connection and reconnect of the server starts a new follow, so a new endpoint is followed at once.
  const watchPlugins = async () => {
    sidecar.module ??= await loadClient()
    const client = sidecarClient()

    if (!client || status.disposed) return
    inventory.watch?.abort()
    const watch = new AbortController()
    inventory.watch = watch
    void followPlugins(client, watch.signal)
  }

  const follow = () =>
    void watchPlugins().catch((cause: unknown) => input.log("plugin watch failed", { cause: String(cause) }))

  const followPlugins = async (client: OpenCodeClient, signal: AbortSignal) => {
    while (!signal.aborted) {
      await readEvents(client, signal).catch(() => undefined)

      if (signal.aborted) return
      // The stream ended while the endpoint stayed the same; subscribe again after a pause.
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  }

  const readEvents = async (client: OpenCodeClient, signal: AbortSignal) => {
    for await (const event of client.event.subscribe({ signal }))
      if (event.type === "plugin.updated" || event.type === "server.connected") relistPlugins()
  }

  // Lists the plugins on the app's own server that ship a `./gui-experimental` bundle and reads each bundle there. A
  // listing that fails is logged and keeps what main runs.
  const listPlugins = async () => {
    sidecar.module ??= await loadClient()
    const client = sidecarClient()

    if (!client || status.disposed) return

    const listed = await client.plugin.list().then(
      (result) => result.data,
      (cause: unknown) => void input.log("plugin listing failed", { cause: String(cause) }),
    )

    if (!listed) return

    const shipped = listed.filter(shipsPluginGui)
    const reserved = shipped.flatMap((plugin) => (pluginIdAvailable(plugin.id, definitions) ? [] : [plugin.id]))

    const parts = {
      server: new Set(shipped.flatMap((plugin) => (plugin.features.server ? [plugin.id] : []))),
      tui: new Set(shipped.flatMap((plugin) => (plugin.features.tui ? [plugin.id] : []))),
      unsupported: new Set<string>(),
      unreadable: new Map<string, string>(),
    }

    const read = await Promise.all(
      shipped.filter((plugin) => !reserved.includes(plugin.id)).map((plugin) => readPlugin(client, plugin.id, parts)),
    )

    if (status.disposed) return
    applyPlugins(new Map(read.flatMap((entry) => (entry ? [entry] : []))), reserved, parts)
  }

  // Reads a plugin's bundle and evaluates each new revision once. A read that fails is logged and keeps the bundle
  // main runs, or lists a new plugin with the failure until the next change; a plugin limited to other systems is left
  // out.
  const readPlugin = async (
    client: OpenCodeClient,
    id: string,
    parts: { readonly unsupported: Set<string>; readonly unreadable: Map<string, string> },
  ) => {
    const previous = plugins.get(id)

    const bundle = await client.plugin.gui({ id }).then(
      (result) => result.data,
      (cause: unknown) => {
        input.log("plugin bundle read failed", { id, cause: String(cause) })

        if (!previous) parts.unreadable.set(id, cause instanceof Error ? cause.message : String(cause))
      },
    )

    if (!bundle) return previous && ([id, previous] as const)

    if (previous?.bundle.revision === bundle.revision) return [id, previous] as const

    if (skipped.get(id) === bundle.revision) return void parts.unsupported.add(id)

    if (status.disposed) return undefined

    const loaded = await evaluateMain(bundle.code).then(
      (value) => ({ ok: true as const, value }),
      (cause: unknown) => ({ ok: false as const, cause }),
    )

    if (!loaded.ok || runsOn(loaded.value, os)) return [id, { bundle, loaded }] as const
    skipped.set(id, bundle.revision)

    return void parts.unsupported.add(id)
  }

  // Starts, reloads and stops plugins' `main` setups to match a listing, and sends windows the new set: a new bundle
  // revision reloads its plugin.
  const applyPlugins = (
    next: ReadonlyMap<string, ListedPlugin>,
    reserved: readonly string[],
    parts: Pick<Inventory, "server" | "tui" | "unsupported" | "unreadable">,
  ) => {
    const removed = [...plugins.keys()].filter((id) => !next.has(id))

    const changes = [...next].flatMap(([id, plugin]) => {
      const previous = plugins.get(id)

      if (previous === plugin) return []

      return [{ id, plugin, previous }]
    })

    if (
      removed.length === 0 &&
      changes.length === 0 &&
      reserved.join("\n") === inventory.reserved.join("\n") &&
      [...parts.server].join("\n") === [...inventory.server].join("\n") &&
      [...parts.tui].join("\n") === [...inventory.tui].join("\n") &&
      [...parts.unsupported].join("\n") === [...inventory.unsupported].join("\n") &&
      [...parts.unreadable].join("\n") === [...inventory.unreadable].join("\n")
    )
      return
    removed.forEach((id) => plugins.delete(id))
    changes.forEach((change) => plugins.set(change.id, change.plugin))
    inventory.reserved = reserved
    inventory.server = parts.server
    inventory.tui = parts.tui
    inventory.unsupported = parts.unsupported
    inventory.unreadable = parts.unreadable
    changed()
    broadcast(new PluginGuisChanged(pluginGuis()))
    removed.forEach((id) => void lifecycle.deactivate(id, () => lifecycle.forget(id)))
    changes.forEach((change) => {
      if (!change.previous) return void lifecycle.activate(change.id)

      if (manager.enabled(change.id)) void lifecycle.reload(change.id)
    })
  }

  // One listing at a time; a change during a listing lists once more.
  const relistPlugins = () => {
    if (status.listing) return void (status.relist = true)
    status.listing = true
    void listPlugins()
      .catch((cause: unknown) => input.log("plugin listing failed", { cause: String(cause) }))
      .finally(() => {
        status.listing = false

        if (!status.relist) return
        status.relist = false
        relistPlugins()
      })
  }

  // What every window loads: the plugins main runs, and the ids a built-in claims.
  const pluginGuis = () => ({
    plugins: [...plugins].map(([id, plugin]) => ({
      id,
      revision: plugin.bundle.revision,
      code: plugin.bundle.code,
      options: plugin.bundle.options,
    })),
    reserved: inventory.reserved,
  })

  const resolveMessages = async (catalog?: BuiltinCatalog): Promise<Messages> => {
    const english = catalog?.en ?? {}
    const locale = nativeLocale()
    const source = locale === "en" ? undefined : catalog?.[locale]

    if (!source) return english
    const loaded = Predicate.isFunction(source) ? (await source()).default : source

    return { ...english, ...loaded }
  }

  /** A loaded revision of the plugin's main code; each instance of it gets its own setup context. */
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

    function add<T>(registry: Registry<T>, item: T | (() => T | undefined)): Cleanup {
      if (signal.aborted) return () => {}

      const key = `${id}/${++status.sequence}`
      entries.set(key, { registry: registry.id, plugin: id, value: item })

      if (registry.id === MenubarItem.id) scheduleMenubar()

      return contribute(() => {
        if (entries.delete(key) && registry.id === MenubarItem.id) scheduleMenubar()
      })
    }

    function list<T>(registry: Registry<T>): readonly T[] {
      return [...entries.values()].flatMap((entry) => {
        if (entry.registry !== registry.id) return []
        const value = read(entry)

        // SAFETY: only `add` stores entries, under the id of the typed registry it was given, so this registry's items
        // are T.
        return value === undefined ? [] : [value as T]
      })
    }

    function provide<S extends IpcSpec>(token: Ipc<S>, impl: IpcImpl<S>): IpcProvider<S>
    function provide(token: Ipc, impl: IpcImpl<IpcSpec>): IpcProvider<IpcSpec> {
      // Plugin bundles are plain JavaScript: a contract token here has no spec to serve.
      if (token.kind !== "ipc") throw new Error("Contracts are provided by a plugin's renderer entry")

      const ipc = token.id

      // A plugin provides only under its own id, so windows find the provider from the Ipc's id.
      if (ipc !== id && !ipc.startsWith(`${id}.`)) throw new Error(`${id} provides only its own Ipcs, not "${ipc}"`)

      const current = ipcs.get(ipc)

      if (current && current.plugin !== id) throw new Error(`Ipc "${ipc}" is already provided by ${current.plugin}`)

      const methods = new Map(
        Object.keys(token.spec.methods).map((name) => {
          const method = Predicate.hasProperty(impl, name) ? impl[name] : undefined

          if (!isMethod(method)) throw new Error(`Ipc "${ipc}" is missing method "${name}"`)

          return [name, (value: Value, caller: Caller) => method.call(impl, value, caller)] as const
        }),
      )

      const stateOf = Predicate.hasProperty(impl, "state") ? impl.state : undefined

      const provider: Provider = {
        plugin: id,
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
            broadcast(new PluginAvailable({ ipc, available: false }))
          })

      if (!signal.aborted) {
        ipcs.set(ipc, provider)
        broadcast(new PluginAvailable({ ipc, available: true }))
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
            return input.log("plugin event encoding failed", { ipc, name, cause: String(encoded.cause) })
          const event = new PluginEvent({ ipc, name, data: encoded.value })

          if (window === undefined) return broadcast(event)
          const win = BrowserWindow.fromId(window)

          if (win && !win.isDestroyed()) emitIpcEvent(win.webContents, event)
        },
        dispose,
      }
    }

    const builtin = definitions.some((definition) => definition.id === id)
    const storage = () => (created.storage ??= createStorage(input.state, getStore, id, builtin))

    // Every plugin's context has the members only built-ins use, which `builtinMainContext` reads.
    const context: BuiltinMainContext = {
      id,
      options: loaded.options ?? {},
      get client() {
        return loaded.client?.() ?? unavailableClient()
      },
      signal,
      onCleanup: (fn) => void instance.scope.addFinalizer(fn),
      get storage() {
        return storage()
      },
      get log() {
        return desktopLog
      },
      get lifecycle() {
        return (created.lifecycle ??= {
          restart: (handoff) => lifecycle.restart(instance.scope, () => input.restart(handoff)),
        } satisfies Lifecycle)
      },
      get app() {
        return about
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
      // A returned cleanup is a finalizer, as a server or TUI plugin's returned cleanup runs when it stops.
      setup: () =>
        Promise.resolve(loaded.setup(context)).then((cleanup) => {
          if (Predicate.isFunction(cleanup)) instance.scope.addFinalizer(cleanup)
        }),
    }
  }

  const known = (id: string) => local.some((definition) => definition.id === id) || plugins.has(id)

  const installed = (): PluginInstalled[] => [
    ...local.map((definition) => ({
      id: definition.id,
      builtin: true,
      enabled: manager.enabled(definition.id),
      ...failure(lifecycle.failure(definition.id)),
    })),

    ...[...plugins.keys()].map((id) => ({
      id,
      builtin: false,
      enabled: manager.enabled(id),
      server: inventory.server.has(id),
      tui: inventory.tui.has(id),
      ...failure(lifecycle.failure(id)),
    })),

    ...[...inventory.unsupported].map((id) => ({
      id,
      builtin: false,
      enabled: manager.enabled(id),
      server: inventory.server.has(id),
      tui: inventory.tui.has(id),
      unsupported: true,
    })),

    ...[...inventory.unreadable].map(([id, error]) => ({
      id,
      builtin: false,
      enabled: manager.enabled(id),
      server: inventory.server.has(id),
      tui: inventory.tui.has(id),
      error,
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
    /**
     * Activates every enabled main plugin, then follows the app's own server for plugin GUIs. The app calls this once
     * its first window is up.
     */
    async start() {
      inventory.stop ??= SidecarCredentials.onChange(follow)
      follow()
      await Promise.all(local.map((definition) => lifecycle.activate(definition.id)))
    },
    /** Activates the plugin whose id the Ipc's id names, ahead of `start`. */
    demand(ipc: string) {
      if (ipcs.has(ipc)) return

      const id = [...local.map((definition) => definition.id), ...plugins.keys()].find(
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
      const encoded = Schema.encodeUnknownExit(schema)(stateOf(window))

      if (Exit.isSuccess(encoded)) return { available: true, state: encoded.value }
      input.log("plugin state encoding failed", { ipc, cause: String(encoded.cause) })

      return { available: true }
    },
    async call(request: { readonly ipc: string; readonly method: string; readonly input?: unknown }, caller: Caller) {
      const provider = ipcs.get(request.ipc)

      if (!provider) throw new PluginError("unavailable")
      const method = provider.methods.get(request.method)
      const spec = method ? provider.spec.methods[request.method] : undefined

      if (!method || !spec) throw new PluginError("method")

      const value = spec.input
        ? await Schema.decodeUnknownPromise(spec.input)(request.input).catch((cause: unknown) => {
            throw new PluginError("input", { cause, message: String(cause) })
          })
        : undefined

      // Withdrawn while the input decoded: the disposed instance is not called.
      if (ipcs.get(request.ipc) !== provider) throw new PluginError("unavailable")

      const output = await method(value, {
        window: caller.window,
        signal: AbortSignal.any([caller.signal, provider.signal]),
      })

      if (!spec.output) return undefined

      return Schema.encodeUnknownPromise(spec.output)(output).catch((cause: unknown) => {
        throw new PluginError("output", { cause, message: String(cause) })
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
      if (!known(id)) throw new PluginError("notFound")

      manager.setEnabled(id, true)
      changed()
      await lifecycle.activate(id)
    },
    async disable(id: string) {
      if (!known(id)) throw new PluginError("notFound")

      manager.setEnabled(id, false)
      // Windows stop the plugin now; main's teardown may take until its deadline.
      changed()
      await lifecycle.deactivate(id)
      // A plugin that is off shows no error from its last run.
      lifecycle.forget(id)
      changed()
    },
    /**
     * Reloads a plugin. A reload that fails keeps the last good revision running. A plugin reruns the bundle main
     * last read; a new bundle arrives through the listing.
     */
    async reload(id: string) {
      if (!known(id)) throw new PluginError("notFound")
      await lifecycle.reload(id)
      changed()
    },

    /** The plugin GUIs main runs, which windows load; `PluginGuisChanged` brings each change. */
    pluginGuis,

    /** Disposes every main plugin but one a restart handoff keeps; quitting awaits their async cleanups. */
    async dispose() {
      status.disposed = true
      inventory.stop?.()
      inventory.watch?.abort()
      stopWindows()
      stopLocale()
      // The menu is not rebuilt from here on (`publishMenubar`), so a kept plugin's items stay in it.
      await lifecycle.dispose()
    },
  }
}

function read(entry: Contribution) {
  return isGetter(entry.value) ? entry.value() : entry.value
}

// Plugin bundles are plain JavaScript: these check the shapes the SDK types promise before the host relies on them.
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

function failure(value: string | undefined) {
  return value === undefined ? {} : { error: value }
}
