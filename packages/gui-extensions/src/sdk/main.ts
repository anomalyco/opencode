import type { BrowserWindow, NativeImage, WebContentsView } from "electron"
import type { Schema } from "effect"
import {
  Point,
  type BaseContext,
  type Build,
  type Cleanup,
  type Declared,
  type DeclaredStores,
  type Definition,
  type Ipc,
  type IpcImpl,
  type IpcProvider,
  type IpcRef,
  type IpcSpec,
  type MainStoreDeclaration,
  type MainStoreFrom,
  type Persisted,
} from "./core"
import type { Scope } from "./scope"

export * from "./core"

export * from "./scope"

/** The app's main windows. */
export interface Windows {
  /**
   * A main window by id.
   *
   * @param id - The window's id, e.g. `Caller.window`.
   */
  get(id: number): BrowserWindow | undefined
  /** Every open main window. */
  list(): readonly BrowserWindow[]
  /** The main window that had focus last. */
  focused(): BrowserWindow | undefined
  /**
   * Listens to windows opening or closing. The listener is removed when the instance goes away.
   *
   * @param event - `open`: a main window opened; `close`: one closed.
   * @param handler - Receives the window.
   * @returns Removes the listener early.
   */
  on(event: "open" | "close", handler: (window: BrowserWindow) => void): Cleanup
}

/** A web page placed in a window's layout. The window shows it with `Embeds.View`. */
export interface Embed {
  /** The id a window passes to `Embeds.View` and `Embeds.capture`. */
  readonly id: string
  /**
   * Page-side gate. The view shows only while the renderer lays it out AND show(true).
   *
   * @param visible - Whether the page may show.
   */
  show(visible: boolean): void
  /**
   * Runs when the view goes on or off screen, including when the renderer paints a still in its place.
   *
   * @param event - `visible`.
   * @param handler - Receives whether the view is on screen.
   * @returns Removes the listener.
   */
  on(event: "visible", handler: (visible: boolean) => void): Cleanup
  /** A still of the page; undefined while it is not shown. */
  capture(): Promise<NativeImage | undefined>
  /** Removes the view from the window. The host also disposes it when the instance goes away. */
  dispose(): void
}

/** Places web pages (Electron WebContentsViews) in a window's layout. */
export interface Embeds {
  /**
   * The renderer presents it with the renderer SDK's `Embeds.View`; the host owns bounds, zoom, corners, and occlusion.
   * Created after the instance went away, it is disposed at once.
   *
   * @param view - The page's view.
   * @param window - The window it belongs to.
   */
  create(view: WebContentsView, window: BrowserWindow): Embed
}

/**
 * Main-process storage, in the extension's namespace (`extension.<id>`), shared by every window. Declare
 * `Store.main` stores for keys known up front; this is for keys only known at runtime.
 */
export interface Storage {
  /**
   * The window's `Persisted` shape, read and written synchronously: `value` is always defined and `ready()` always
   * true. Values are stored as the schema's canonical JSON; the schema must not need services. A stored value that
   * fails to decode reads as `initial`. Each write reaches the database before it returns. `update` changes a copy of
   * the value; a mutation may also return the next value, which replaces it, so a number, `null` or a new list is
   * written that way.
   *
   * @param key - The store's key in your namespace.
   * @param options - The store's options.
   *
   * @example
   * ```ts
   * const tabs = ctx.storage.store(`restore:${session}`, { schema: Tabs, initial: [] })
   * tabs.update(() => next)
   * ```
   */
  store<S extends Schema.ConstraintCodec<unknown, unknown>>(
    key: string,
    options: {
      /** Decodes the stored JSON; any schema. */
      readonly schema: S
      /** The value before anything is stored, and after `remove`. */
      readonly initial: S["Type"]
      /** Older homes to import the value from once, while the key holds nothing. See `MainStoreFrom`. */
      readonly from?: MainStoreFrom | readonly MainStoreFrom[]
    },
  ): Persisted<S["Type"], S["Type"]>
  /**
   * Deletes the value, so opening the key again reads its `initial`. Pass the store's `from`: every older home it names
   * is deleted too, so none is imported again.
   *
   * @param key - The store's key in your namespace.
   * @param options - The store's options.
   */
  remove(
    key: string,
    options?: {
      /** The store's `from`. */
      readonly from?: MainStoreFrom | readonly MainStoreFrom[]
    },
  ): void
}

/** A server endpoint main can call, with its credentials. */
export interface ServerEndpoint {
  /** The server's id, as the window's `ServerRef.id`. */
  readonly id: string
  /** The base URL. */
  readonly url: string
  /** Headers to send, with the `authorization` the server needs. */
  readonly headers: Readonly<Record<string, string>>
  /** Same machine as this app's own server. Loopback HTTP alone does not qualify. */
  readonly local: boolean
  /** Credentials a window configured for the server; `headers` already carries them. None for the app's own server. */
  readonly username?: string
  /** The configured password; `headers` already carries it. */
  readonly password?: string
}

/** The opencode CLI the desktop app runs. */
export interface Cli {
  /** The CLI's version. */
  readonly version: string
  /** The argv that runs it: the executable, or a development command such as `bun run … src/index.ts`. */
  readonly command: readonly string[]
  /** The executable's path; undefined when it runs from source. */
  readonly binary?: string
  /** An unpackaged app running the CLI from source. */
  readonly development: boolean
}

/** The server endpoints the app's windows use. */
export interface ServerEndpoints {
  /**
   * An endpoint by server id: "sidecar" for the app's own server, else a server a window lists. Undefined until that
   * server is known (the sidecar is running, or a window reported the server).
   *
   * @param id - The server's id, as the window's `ServerRef.id`.
   */
  get(id: string): ServerEndpoint | undefined
}

/** The app process's lifetime. */
export interface Lifecycle {
  /**
   * Marks the app as quitting and disposes every extension but the one whose `keep` scope is passed (the caller's
   * `ctx.scope` by default), then runs handoff (e.g. quitAndInstall) or relaunches. The kept scope outlives shutdown
   * until the handoff settles, and keeps running when it fails (the promise rejects). Only an extension's `ctx.scope`
   * can be kept.
   *
   * @param handoff - Runs once the others are disposed; omit it to relaunch.
   * @param options - Restart options.
   *
   * @example
   * ```ts
   * await ctx.lifecycle.restart(() => updater.quitAndInstall(), { keep: ctx.scope })
   * ```
   */
  restart(
    handoff?: () => void | Promise<void>,
    options?: {
      /** The extension scope that stays until the handoff settles. Defaults to the caller's `ctx.scope`. */
      readonly keep?: Scope
    },
  ): Promise<void>
}

/** The desktop log file. */
export interface Log {
  /**
   * Writes to the desktop log file (included in exported debug logs); each field of `data` is serialized as it is.
   *
   * @param level - `debug`, `info`, `warn` or `error`.
   * @param message - A fixed message; put variable parts in `data`.
   * @param data - Structured fields.
   *
   * @example
   * ```ts
   * ctx.log.write("warn", "update check failed", { error: String(cause) })
   * ```
   */
  write<Data extends Readonly<Record<string, unknown>>>(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data?: Data,
  ): void
}

type MainHandle<S> = S extends MainStoreDeclaration<infer Schema> ? Persisted<Schema["Type"], Schema["Type"]> : never

type MainStores<D> = [D] extends [never]
  ? {}
  : {
      readonly [K in keyof DeclaredStores<D> as DeclaredStores<D>[K] extends MainStoreDeclaration
        ? K
        : never]: MainHandle<DeclaredStores<D>[K]>
    }

/**
 * The spec of each Ipc the definition declares in `provides`, as a full token or an `Ipc.ref`; any spec when there is
 * no definition, as for an installed extension's plain JavaScript.
 */
type ProvidedSpec<D> = [D] extends [never]
  ? IpcSpec
  : Declared<D, "provides">[keyof Declared<D, "provides">] extends infer T
    ? T extends Ipc<infer S>
      ? S
      : T extends IpcRef<infer S>
        ? S
        : never
    : never

/**
 * The setup context in the main process. The APIs the host always provides are properties, each created on first
 * read. Every main extension is one instance for the whole app, shared by all windows. `MainContext<typeof
 * definition>` also types the declared main stores.
 */
export interface MainContext<D = never> extends BaseContext {
  /**
   * Each store the definition declares with `Store.main`, by its name in `stores`. Always loaded: main storage reads
   * synchronously. Window stores are not here.
   *
   * @example
   * ```ts
   * const count = ctx.stores.count
   * count.update((value) => value + 1)
   * ```
   */
  readonly stores: MainStores<D>
  /**
   * The instance's lifetime. `signal` aborts when the extension is disabled, reloaded, or the app quits;
   * `addFinalizer` adds its teardown, and runs it at once when the instance is already gone.
   *
   * @example
   * ```ts
   * ctx.scope.addFinalizer(() => watcher.close())
   * ```
   */
  readonly scope: Scope
  /**
   * Synchronous storage in the extension's namespace, for keys only known at runtime.
   *
   * @example
   * ```ts
   * const tabs = ctx.storage.store(`restore:${session}`, { schema: Tabs, initial: [] })
   * ```
   */
  readonly storage: Storage
  /**
   * The desktop log file.
   *
   * @example
   * ```ts
   * ctx.log.write("info", "tunnel opened", { host })
   * ```
   */
  readonly log: Log
  /**
   * Restarts the app, keeping this extension through a handoff.
   *
   * @example
   * ```ts
   * await ctx.lifecycle.restart(install)
   * ```
   */
  readonly lifecycle: Lifecycle
  /**
   * The running build; `platform` is always "desktop".
   *
   * @example
   * ```ts
   * if (!ctx.build.packaged) return
   * ```
   */
  readonly build: Build
  /**
   * The server endpoints the app's windows use.
   *
   * @example
   * ```ts
   * const server = ctx.serverEndpoints.get("sidecar")
   * ```
   */
  readonly serverEndpoints: ServerEndpoints
  /**
   * The app's main windows.
   *
   * @example
   * ```ts
   * ctx.windows.on("close", (window) => forget(window.id))
   * ```
   */
  readonly windows: Windows
  /**
   * Places web pages in a window's layout.
   *
   * @example
   * ```ts
   * const embed = ctx.embeds.create(new WebContentsView(), window)
   * ```
   */
  readonly embeds: Embeds
  /**
   * The opencode CLI the app runs.
   *
   * @example
   * ```ts
   * spawn(ctx.cli.command[0], [...ctx.cli.command.slice(1), "serve"])
   * ```
   */
  readonly cli: Cli
  /**
   * Provides an Ipc the definition declares in `provides`, for the windows to use. Withdrawn when the instance goes
   * away. `MainSetup<typeof definition>` accepts only those Ipcs; a built-in that provides another one throws. Also
   * throws for a Contract token, an Ipc another extension provides, or an `impl` missing a method.
   *
   * @param token - An Ipc from `provides`; the full token where `provides` names it with `Ipc.ref`.
   * @param impl - Its methods, and `state` when the spec has one.
   * @returns Pushes state and events, or withdraws the Ipc early.
   *
   * @example
   * ```ts
   * const provider = ctx.provide(Updater, { state: () => updater.state(), check, install })
   * ```
   */
  provide<S extends Extract<ProvidedSpec<D>, IpcSpec>>(token: Ipc<S>, impl: IpcImpl<S>): IpcProvider<S>
}

/**
 * A main-process entry: the default export of `main.ts`. `MainSetup<typeof definition>` types the declared main
 * stores in `ctx.stores`; a plain `MainSetup` has none. It may be async; return nothing.
 *
 * @example
 * ```ts
 * const setup: MainSetup<typeof definition> = (ctx) => {
 *   const stored = ctx.stores.keepScreenActive // a declared main store, always loaded
 *   ctx.provide(Pairing, { info, code, screenActive, setScreenActive: (enabled) => stored.update(() => enabled) })
 * }
 * export default setup
 * ```
 */
export type MainSetup<D extends Definition = never> = (ctx: MainContext<D>) => void | Promise<void>

/** An item of the native app menu. */
export interface MenubarItem {
  /**
   * The native menu the item goes in.
   * - `app`: the app menu (macOS).
   * - `file`, `edit`, `view`, `go`, `window`, `help`: the menu of that name.
   */
  readonly menu: "app" | "file" | "edit" | "view" | "go" | "window" | "help"
  /** The item's local id; the host publishes `${extension}.${id}`. */
  readonly id: string
  /** The item's label. Read it from a getter with `ctx.t` so it follows the locale. */
  readonly label: string
  /** Places the item after a sibling: your item's local id, or a built-in item's id. */
  readonly after?: string
  /** Shown disabled while it returns false; read each time the menu is built. Defaults to enabled. */
  readonly enabled?: () => boolean
  /**
   * Runs the item.
   *
   * @param window - The main window that had focus last.
   */
  run(window: BrowserWindow | undefined): void
}

/**
 * A point: an item of the native app menu, contributed from a main entry. Windows without a native menubar show it in
 * the in-app menu.
 *
 * @example
 * ```ts
 * ctx.add(MenubarItem, {
 *   menu: "help",
 *   id: "check",
 *   get label() {
 *     return ctx.t("menu.check")
 *   },
 *   run: () => void check(),
 * })
 * ```
 */
export const MenubarItem = Point.define<MenubarItem>("menubar-item")
