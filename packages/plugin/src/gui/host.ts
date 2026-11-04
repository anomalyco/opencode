/**
 * Host-internal contract between the renderer host (packages/app) and the main host (packages/desktop).
 * Plugins never use this directly; they use Ipc tokens.
 * Payloads are structured-clone values already encoded with the Ipc's schemas. The `ipc` fields name an Ipc by id.
 */

import type { PluginInfo } from "@opencode/client/promise"
import { Cause, Exit, Predicate, Schema } from "effect"
import type { BuiltinStoreDeclaration } from "./builtin.js"
import type { Cleanup, OS, PluginOptions } from "./core.js"
import type { Declarations } from "./declarations.js"
import type { MainSetup } from "./plugin.js"

export { Scope } from "./scope.js"

export { DrawerContext, LifetimeContext, liveAccessor, PanelContext, PluginContext } from "./internal.js"

/**
 * A plugin as a host runs it: its id, its `Plugin.Declarations`, plus the setups the host loads lazily. A built-in's
 * entries are its `renderer.tsx` and `main.ts`; a plugin's `./gui-experimental` bundle becomes a window entry that
 * runs its `setup`.
 */
export interface Entry extends Declarations {
  /** Window state, as `Declarations.stores`; a built-in's stores may name older homes in `builtinFrom`. */
  readonly stores?: Readonly<Record<string, BuiltinStoreDeclaration>>
  /**
   * The plugin's id: a built-in's key in `compose`, or the server plugin's id for a bundle. It prefixes every id the
   * plugin creates: commands (`<id>.<command>`), panel keys (`<id>:<tab>`), stored keys (`plugin.<id>.<key>`), and
   * its contract and Ipc ids (`<id>` or `<id>.<name>`). The plugin reads it as `ctx.id`.
   */
  readonly id: string
  /** Loads the window setup (`Plugin.Setup<typeof definition>`). */
  readonly windowEntry?: () => Promise<{
    /** The window setup. */
    readonly default: (ctx: never) => Cleanup | void
  }>
  /** Loads the main setup (`Plugin.MainSetup<typeof definition>`). */
  readonly mainEntry?: () => Promise<{
    /** The main setup. */
    readonly default: (ctx: never) => Cleanup | void | Promise<Cleanup | void>
  }>
}

/**
 * Composes the app's built-in plugins for one process, the way the host lists them: each built-in's `Plugin.define`
 * declarations plus the entries the host loads lazily (`windowEntry`, `mainEntry`), under its id.
 *
 * @param entries - Every built-in of one process, by id, in the order the host lists them.
 * @returns The entries, each with its id.
 *
 * @example
 * ```ts
 * export const builtins = compose({ pairing: { ...pairing, mainEntry: () => import("./pairing/main") }, review })
 * ```
 */
export function compose(entries: Readonly<Record<string, Omit<Entry, "id">>>): Entry[] {
  return Object.entries(entries).map(([id, entry]) => ({ ...entry, id }))
}

/**
 * Whether a plugin runs on this system: it lists no OS, or lists this one. On the web, where no OS is known, only a
 * plugin that lists none runs. Both hosts apply it to built-ins and plugins alike.
 *
 * @param declarations - The plugin's declared `os`.
 * @param os - This system, or undefined on the web.
 * @returns True when the plugin runs here.
 */
export function runsOn(declarations: Pick<Declarations, "os">, os: OS | undefined) {
  return !declarations.os || (!!os && declarations.os.includes(os))
}

/** One explicit desktop enable-state row. An absent row means there is no setting under that id. */
export interface EnableState {
  /** The plugin id the user saved a setting under. */
  readonly id: string
  /** The saved setting: true enables the plugin; false disables it. */
  readonly enabled: boolean
}

/**
 * Resolves desktop enable state. A built-in always runs, whatever row is saved under its id; any other plugin follows
 * the row saved under its id, or is enabled when there is none. Both hosts use this rule, including a window's preload
 * snapshot.
 *
 * @param plugin - The plugin, and whether it ships with the app.
 * @param state - Explicit saved rows, or the manager's resolved list.
 * @returns Whether the plugin is enabled.
 */
export function pluginEnabled(
  plugin: {
    /** The plugin's id. */
    readonly id: string
    /** Ships with the app. */
    readonly builtin: boolean
  },
  state: readonly EnableState[],
) {
  if (plugin.builtin) return true

  return state.find((item) => item.id === plugin.id)?.enabled ?? true
}

export { pluginSharedModules, pluginWindowModules, type PluginModule } from "./modules.js"

// Node's `builtinModules`, which a window cannot import; bundles may name them with or without `node:`.
const nodeBuiltins = new Set([
  "assert",
  "assert/strict",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "dns/promises",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "inspector/promises",
  "module",
  "net",
  "os",
  "path",
  "path/posix",
  "path/win32",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "readline/promises",
  "repl",
  "stream",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "string_decoder",
  "sys",
  "timers",
  "timers/promises",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "util/types",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
])

/**
 * Whether only the desktop app's main process provides a module: `electron` and Node built-ins. A window gives a
 * plugin's `./gui-experimental` bundle an inert placeholder for it.
 *
 * @param name - The name the bundle requires.
 * @returns True for `electron`, `node:` names and Node built-ins.
 */
export function mainOnlyModule(name: string) {
  return name === "electron" || name.startsWith("node:") || nodeBuiltins.has(name)
}

/**
 * A placeholder for a module that exists only in the other process, so one plugin `./gui-experimental` bundle runs in
 * both: a window gets one for `electron` and Node built-ins, main gets one for Solid and the window-only modules.
 * Bundlers hoist `require` calls and Solid hoists template creation to module scope, so the placeholder accepts any
 * property read, call or construction and returns itself, and ignores writes. It is never a thenable, so a promise
 * never waits on it, and nothing is an instance of it. Code that actually runs in the wrong process gets placeholders
 * back instead of working values; keep each process's code in its entry.
 *
 * @param name - The module's name, shown when the placeholder is converted to a string.
 * @returns The placeholder.
 */
export function inertModule(name: string): InertModule {
  const label = `[inert module ${name}]`

  const handler: ProxyHandler<InertModule> = {
    get(_, key) {
      if (key === "then") return undefined

      if (key === Symbol.toPrimitive || key === "toString") return () => label

      if (key === Symbol.hasInstance) return () => false

      return placeholder
    },
    set: () => true,
    defineProperty: () => true,
    deleteProperty: () => true,
    apply: () => placeholder,
    construct: () => placeholder,
  }

  // Each placeholder wraps its own function, so nothing one bundle does to it reaches another's.
  const placeholder = new Proxy<InertModule>(function inert() {}, handler)

  return placeholder
}

/** A placeholder `inertModule` returns: it answers every property read, call and construction with itself. */
export type InertModule = () => void

/** A plugin's `./gui-experimental` bundle as `evaluatePluginBundle` read it. */
export interface PluginBundle {
  /** The declarations of its `Plugin.define`, checked. The host adds the server plugin's id. */
  readonly definition: Declarations
  /** Its window `setup`; undefined in a plugin for main only. */
  readonly setup?: (ctx: never) => Cleanup | void
  /** Its `main` setup; undefined in a plugin for windows only. */
  readonly main?: MainSetup
}

/** The process that evaluates a plugin's `./gui-experimental` bundle with `evaluatePluginBundle`. */
export interface PluginBundleHost {
  /** Which process evaluates the bundle: `window` or `main`. */
  readonly process: "window" | "main"
  /**
   * Returns the module the bundle requires.
   *
   * @param name - The module name the bundle passes to `require`.
   * @returns The module this process provides.
   * @throws For a module this process does not provide.
   */
  require(name: string): object
}

/**
 * Evaluates a plugin's `./gui-experimental` bundle, a CommonJS module whose default export is its `Plugin.define`, and
 * checks it: the declarations the host reads and at least one setup. Both hosts call it, each with its own `require`.
 * The bundle's code is trusted as much as the server that runs the app, which already loads the plugin.
 *
 * @param code - The bundle's CommonJS code.
 * @param host - The process evaluating it.
 * @returns The checked plugin.
 * @throws When evaluation throws, the default export is not a `Plugin.define` this app supports, or it has no setup.
 */
export function evaluatePluginBundle(code: string, host: PluginBundleHost): PluginBundle {
  const module: BundleModule = { exports: {} }

  new Function("require", "module", "exports", code)(host.require, module, module.exports)
  // `export default` compiles to `exports.default`, or to `module.exports` itself in a bundler's default mode.
  const plugin = Predicate.hasProperty(module.exports, "default") ? module.exports.default : module.exports

  if (!matchesPlugin(plugin)) {
    // The decode names the field that does not match, such as a lazily loaded locale or an unknown OS.
    const decoded = Schema.decodeUnknownExit(BundleDefinition)(plugin)
    const problem = Exit.isFailure(decoded) ? Cause.pretty(decoded.cause) : "it does not match"

    throw new Error(
      `A plugin's ./gui-experimental bundle must default-export a \`Plugin.define\` from \`@opencode/plugin/gui\`: ${problem}`,
    )
  }

  if (!plugin.setup && !plugin.main)
    throw new Error("A plugin's GUI must have a window `setup`, a `main` setup, or both")

  return {
    definition: {
      os: plugin.os,
      // SAFETY: `matchesPlugin` checked each store's scope and schema; `is` keeps the declaration whole.
      stores: plugin.stores as Declarations["stores"],
      i18n: plugin.i18n && { ...plugin.i18n, en: plugin.i18n.en ?? {} },
    },
    // SAFETY: a bundle is plain JavaScript; a function is all the host can check of a setup.
    setup: plugin.setup as PluginBundle["setup"],
    // SAFETY: as above, for the main setup.
    main: plugin.main as PluginBundle["main"],
  }
}

/** The CommonJS module a bundle fills. */
type BundleModule = { exports: object }

// What the host reads of a plugin's GUI, checked once here: a malformed store would otherwise throw inside the host's
// shared memos and take every plugin down. `is` checks without copying.
const Setup = Schema.declare(Predicate.isFunction)

const BundleDefinition = Schema.Struct({
  os: Schema.optional(Schema.Array(Schema.Literals(["macos", "windows", "linux"]))),
  stores: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        scope: Schema.Literals(["global", "session"]),
        schema: Schema.declare(Schema.isSchema),
      }),
    ),
  ),
  // A plugin's catalog ships every locale inline; only built-ins load locales lazily.
  i18n: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String))),
  setup: Schema.optional(Setup),
  main: Schema.optional(Setup),
})

const matchesPlugin = Schema.is(BundleDefinition)

/**
 * Whether a plugin's GUI may take an id. Built-ins win: a plugin cannot take a built-in's id, an id that nests under
 * one or that one nests under (tokens and stored keys resolve by dot-separated prefix), or the `opencode` namespace.
 * Both hosts check it, each against its own built-ins.
 *
 * @param id - The server plugin's id.
 * @param builtins - The host's built-in definitions, on every OS.
 * @returns True when no built-in claims the id.
 */
export function pluginIdAvailable(id: string, builtins: readonly Pick<Entry, "id">[]) {
  return [{ id: "opencode" }, ...builtins].every(
    (taken) => id !== taken.id && !id.startsWith(`${taken.id}.`) && !taken.id.startsWith(`${id}.`),
  )
}

/** Where an embed sits in its window, as the renderer measured it. */
export interface BridgeLayout {
  /** The embed should be on screen. */
  readonly visible: boolean
  /** Its box in window pixels; absent while it is not laid out. */
  readonly bounds?: {
    /** Left edge. */
    readonly x: number
    /** Top edge. */
    readonly y: number
    /** Width. */
    readonly width: number
    /** Height. */
    readonly height: number
  }
  /** The window's content size the bounds were measured against. */
  readonly viewport?: {
    /** Content width in window pixels. */
    readonly width: number
    /** Content height in window pixels. */
    readonly height: number
  }
  /** RGBA of the backdrop the rounded corners show. */
  readonly background?: readonly [number, number, number, number]
  /** Radius of the bottom corners. */
  readonly radius?: number
  /** The rounded card's hairline ring, which the corner masks would otherwise paint over. */
  readonly border?: {
    /** RGBA of the ring. */
    readonly color: readonly [number, number, number, number]
    /** Ring width in window pixels. */
    readonly width: number
  }
}

/** A GUI plugin as main lists it: a built-in, or the GUI of a plugin on the desktop app's own server. */
export interface Installed {
  /** The plugin's id. */
  readonly id: string
  /** Ships with the app. */
  readonly builtin: boolean
  /** The user has it enabled. */
  readonly enabled: boolean
  /** Why its main entry failed, if it did. */
  readonly error?: string
  /** A plugin from the config with a server part, which this row's switch leaves running. */
  readonly server?: boolean
  /** A plugin from the config that also exports `./tui`, which `cli.json` turns off; a built-in has no TUI part. */
  readonly tui?: boolean
  /** A plugin from the config whose `os` leaves out this system: it never runs here; Extensions › Plugins says so. */
  readonly unsupported?: boolean
}

/**
 * Whether a server plugin's GUI loads: an active plugin with an id, not one of the server's own built-ins, that exports
 * `./gui-experimental`. Main lists plugins with it; `pluginIdAvailable` then checks the id against the built-ins.
 *
 * @param plugin - A plugin as the server lists it.
 * @returns True when the plugin's `./gui-experimental` bundle should load.
 */
export function shipsPluginGui(plugin: PluginInfo): plugin is PluginInfo & {
  /** The server plugin's id, which the host gives its GUI. */
  readonly id: string
} {
  return !!plugin.id && plugin.source.type !== "builtin" && plugin.state.status === "active" && !!plugin.features.gui
}

/** A plugin's GUI as main read it from the desktop app's own server: what every window evaluates. */
export interface BridgePluginGui {
  /** The server plugin's id, which the host gives its GUI. */
  readonly id: string
  /** The bundle's opaque revision; a new one makes a window evaluate the bundle again. */
  readonly revision: string
  /** The bundle's CommonJS code. */
  readonly code: string
  /** The plugin's options from `opencode.json`, its GUI's `ctx.options`. */
  readonly options: PluginOptions
}

/** The plugin GUIs main runs. Main alone lists them; windows load what it sends. */
export interface BridgePluginGuis {
  /** The plugins whose GUI loads on this system, after main's id and OS checks. */
  readonly plugins: readonly BridgePluginGui[]
  /** Plugins whose GUI cannot load because a built-in claims the id; Extensions › Plugins reports them. */
  readonly reserved: readonly string[]
}

/**
 * A message main pushes to a window.
 * - `state`: an Ipc's new state for this window.
 * - `event`: an Ipc event.
 * - `available`: an Ipc's provider came or went.
 * - `installed`: the installed list changed.
 * - `pluginGuis`: the plugin GUIs main runs changed.
 * - `focus`: the window gained or lost focus.
 * - `menubarItems`: the native menu's plugin items changed.
 */
export type BridgeMessage =
  | {
      /** An Ipc's new state. */
      readonly type: "state"
      /** The Ipc's id. */
      readonly ipc: string
      /** The encoded state. */
      readonly state: unknown
    }
  | {
      /** An Ipc event. */
      readonly type: "event"
      /** The Ipc's id. */
      readonly ipc: string
      /** The event's name. */
      readonly name: string
      /** The encoded data. */
      readonly data: unknown
    }
  | {
      /** An Ipc's provider came or went. */
      readonly type: "available"
      /** The Ipc's id. */
      readonly ipc: string
      /** It is provided now. */
      readonly available: boolean
    }
  | {
      /** The installed list changed. */
      readonly type: "installed"
      /** The new list. */
      readonly list: readonly Installed[]
    }
  | {
      /** The window gained or lost focus; focus inside one of its embeds counts as the window's. */
      readonly type: "focus"
      /** The window is focused now. */
      readonly focused: boolean
    }
  | ({
      /** The plugin GUIs main runs changed. */
      readonly type: "pluginGuis"
    } & BridgePluginGuis)
  | {
      /** The native menu's plugin items changed. */
      readonly type: "menubarItems"
      /** The new items. */
      readonly items: readonly BridgeMenubarItem[]
    }

/** A `MenubarItem` as main publishes it to windows that draw their own menu. */
export interface BridgeMenubarItem {
  /** The menu it goes in. */
  readonly menu: string
  /** `${plugin}.${id}`. */
  readonly id: string
  /** The label. */
  readonly label: string
  /** The item it follows. */
  readonly after?: string
  /** The item is enabled now. */
  readonly enabled: boolean
}

/** What the desktop preload exposes to the renderer host; undefined on the web. */
export interface Bridge {
  /** The app runs packaged, as main's `App.packaged` says; the window's `App` reports the same. */
  readonly packaged: boolean
  /**
   * Calls an Ipc method.
   *
   * @param input - The Ipc, the method and the encoded input.
   * @param signal - Aborts the call.
   * @returns The encoded output.
   */
  // SAFETY: the reply is the method's output as its schema encoded it; the renderer host decodes it with that schema.
  /* oxlint-disable anti-slop/no-unknown-returns -- see SAFETY above */
  call(
    input: {
      /** The Ipc's id. */
      readonly ipc: string
      /** The method's name. */
      readonly method: string
      /** The encoded input. */
      readonly input: unknown
    },
    signal?: AbortSignal,
  ): Promise<unknown>
  /* oxlint-enable anti-slop/no-unknown-returns */
  /**
   * Starts state sync for this window. Resolves with the current availability and state.
   *
   * @param ipc - The Ipc's id.
   */
  subscribe(ipc: string): Promise<{
    /** The Ipc is provided. */
    readonly available: boolean
    /** Its encoded state for this window. */
    readonly state?: unknown
  }>
  /**
   * Listens to every message main pushes.
   *
   * @param listener - Receives each message.
   * @returns Removes the listener.
   */
  on(listener: (message: BridgeMessage) => void): () => void
  /**
   * Lays out an embed, or hides it without a layout.
   *
   * @param id - The embed's id.
   * @param layout - Where it goes.
   */
  embed(id: string, layout?: BridgeLayout): void
  /**
   * A JPEG still of an embed.
   *
   * @param id - The embed's id.
   */
  capture(id: string): Promise<Uint8Array | undefined>
  /**
   * Runs a native menubar item from the in-app (Windows) menu.
   *
   * @param id - `${plugin}.${id}`.
   */
  runMenubarItem(id: string): void
  /**
   * Tells main the current server endpoints so `ServerEndpoints.get(id)` can resolve them.
   *
   * @param servers - The window's servers.
   */
  configure(
    servers: readonly {
      /** The server's id. */
      readonly id: string
      /** Its base URL. */
      readonly url: string
      /** The HTTP basic password; the user name is always `opencode`. */
      readonly password?: string
    }[],
  ): void
  /**
   * The plugin GUIs main runs. Main lists the plugins on the desktop app's own server and reads their
   * `./gui-experimental` bundles itself, following that server's `plugin.updated` event; a `pluginGuis` message brings
   * each change after this.
   *
   * @returns The plugins whose GUI loads, and the ids a built-in claims.
   */
  pluginGuis(): Promise<BridgePluginGuis>
  /** The plugin manager. */
  readonly manager: {
    /**
     * Explicit enable-state rows from the existing preload startup reply. Undefined (or an omitted promise) means
     * unknown: activation waits for `list()` or a live list, never assumes all are enabled. An empty list is
     * authoritative: no saved settings. A rejected promise also falls back to the manager list.
     */
    readonly initial?: Promise<readonly EnableState[] | undefined>
    /** The installed plugins, built-ins included. */
    list(): Promise<readonly Installed[]>
    /**
     * Enables a plugin.
     *
     * @param id - The plugin's id.
     */
    enable(id: string): Promise<void>
    /**
     * Disables a plugin.
     *
     * @param id - The plugin's id.
     */
    disable(id: string): Promise<void>
    /**
     * Reloads a plugin's main entry; a failed reload keeps the last good revision.
     *
     * @param id - The plugin's id.
     */
    reload(id: string): Promise<void>
  }
}
