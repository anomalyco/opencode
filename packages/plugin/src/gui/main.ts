import type { BrowserWindow, NativeImage, WebContentsView } from "electron"
import type { Schema } from "effect"
import {
  Registry,
  type BaseContext,
  type App,
  type Cleanup,
  type Ipc,
  type IpcImpl,
  type IpcProvider,
  type IpcSpec,
  type Persisted,
} from "./core.js"

export * from "./core.js"

export * as Plugin from "./plugin.js"

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
   * A window shows it with the window SDK's `Embeds.View`; the host owns bounds, zoom, corners, and occlusion.
   * Created after the instance went away, it is disposed at once.
   *
   * @param view - The page's view.
   * @param window - The window it belongs to.
   */
  create(view: WebContentsView, window: BrowserWindow): Embed
}

/** Main-process storage, in the plugin's namespace (`plugin.<id>`), shared by every window. */
export interface Storage {
  /**
   * The window's `Persisted` shape, read and written synchronously: `value` is always defined and `ready()` always
   * true. Values are stored as the schema's canonical JSON; the schema must not need services. A stored value that
   * fails to decode reads as `initial`. Each write reaches the database before it returns. `update` changes a copy of
   * the value through a deep-mutable draft; `set` replaces it, including a number, `null` or a new list.
   *
   * @param key - The store's key in your namespace.
   * @param options - The store's options.
   *
   * @example
   * ```ts
   * const tabs = ctx.storage.store(`restore:${session}`, { schema: Tabs, initial: [] })
   * tabs.set(next)
   * ```
   */
  store<S extends Schema.ConstraintCodec<unknown, unknown>>(
    key: string,
    options: {
      /** Decodes the stored JSON; any schema. */
      readonly schema: S
      /** The value before anything is stored, and after `remove`. */
      readonly initial: S["Type"]
    },
  ): Persisted<S["Type"], S["Type"]>
  /**
   * Deletes the value, so opening the key again reads its `initial`.
   *
   * @param key - The store's key in your namespace.
   */
  remove(key: string): void
}

/** A server endpoint main can call, with its credentials. */
export interface ServerEndpoint {
  /** The server's id, as the window's `ServerRef.id`. */
  readonly id: string
  /** The base URL. */
  readonly url: string
  /** Headers to send, with the `authorization` the server needs. */
  readonly headers: Readonly<Record<string, string>>
  /**
   * The endpoint is this app's own server, so its paths are this machine's paths. Other servers on this machine, such
   * as one in WSL or on another local port, report false.
   */
  readonly sameMachine: boolean
  /** The password a window configured for the server; `headers` already carries it. None for the app's own server. */
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

/**
 * The setup context in the main process. The APIs the host always provides are properties, each created on first
 * read. Every main plugin is one instance for the whole app, shared by all windows.
 */
export interface MainContext extends BaseContext {
  /**
   * Runs `fn` when the plugin goes away, last registered first; at once when it is already gone. A setup may also
   * return its cleanup.
   *
   * @param fn - The teardown; an async one delays quitting until it settles, for at most 3 seconds.
   *
   * @example
   * ```ts
   * ctx.onCleanup(() => watcher.close())
   * ```
   */
  onCleanup(fn: Cleanup): void
  /**
   * Synchronous storage in the plugin's namespace: `value` is always defined.
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
   * The running app, as `ctx.app` in server and TUI plugins; `platform` is always "desktop".
   *
   * @example
   * ```ts
   * if (!ctx.app.packaged) return
   * ```
   */
  readonly app: App
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
   * Provides an Ipc for the plugin's windows (`ctx.main`) and other plugins (`ctx.use`). Withdrawn when the instance
   * goes away. Throws for an Ipc whose id is not your plugin's id or under it (`<id>.<name>`), for a Contract token,
   * or for an `impl` missing a method.
   *
   * @param token - The Ipc.
   * @param impl - Its methods, and `state` when the spec has one.
   * @returns Pushes state and events, or withdraws the Ipc early.
   *
   * @example
   * ```ts
   * const provider = ctx.provide(Downloads, { state: () => downloads.state(), start, cancel })
   * ```
   */
  provide<S extends IpcSpec>(token: Ipc<S>, impl: IpcImpl<S>): IpcProvider<S>
}

/** An item of the native app menu. */
export interface MenubarItem {
  /**
   * The native menu the item goes in.
   * - `app`: the app menu (macOS).
   * - `file`, `edit`, `view`, `go`, `window`, `help`: the menu of that name.
   */
  readonly menu: "app" | "file" | "edit" | "view" | "go" | "window" | "help"
  /** The item's local id; the host publishes `${plugin}.${id}`. */
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
 * The registry of native app menu items, contributed from main entries. Windows without a native menubar show them
 * in the in-app menu.
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
export const MenubarItem = Registry.define<MenubarItem>("menubar-item")
