import type { Accessor } from "solid-js"
import type {
  BaseContext,
  Build,
  Cleanup,
  Contract,
  Declared,
  DeclaredStores,
  Definition,
  Ipc,
  IpcClient,
  IpcRef,
  Live,
  MainStoreDeclaration,
  Persisted,
  StoreDeclaration,
  TokenValue,
  Usable,
} from "./core"
import type {
  Appearance,
  Desktop,
  Dialogs,
  Embeds,
  Keybinds,
  Layout,
  Links,
  Locale,
  Router,
  Screen,
  Servers,
  SessionRef,
  Sessions,
  Storage,
  System,
  Workspaces,
} from "./host-apis"

/**
 * What every window entry gets. Contracts other extensions provide are read through `Setup<typeof Definition>`, from
 * the tokens the definition declares. The APIs the host always provides are properties, each created on first read.
 * Setup runs under the extension's root owner: Solid's `onCleanup` in setup runs when the extension goes away.
 * `useExtension()` returns the same object inside contributions.
 */
export interface Context extends BaseContext {
  /**
   * Aborts when the extension is disabled, reloaded, or the window closes. After an `await` there is no owner, so
   * return if it aborted, and listen to it for teardown that starts after the await.
   *
   * @example
   * ```ts
   * const config = await load({ signal: ctx.signal })
   * if (ctx.signal.aborted) return
   * ```
   */
  readonly signal: AbortSignal
  /**
   * Provides an in-process contract. Withdrawn with the current owner, else with the extension. An Ipc token throws:
   * Ipcs are provided by the main entry.
   *
   * @param token - The contract.
   * @param impl - Its implementation.
   * @returns Withdraws the contract early.
   *
   * @example
   * ```ts
   * ctx.provide(Changes, { diffs, open })
   * ```
   */
  provide<T>(token: Contract<T>, impl: T): Cleanup
  /**
   * Side panel tabs, the dock, scroll offsets, and the settings and project dialogs.
   *
   * @example
   * ```ts
   * ctx.layout.open(`${ctx.id}:main`, session, { background: true })
   * ```
   */
  readonly layout: Layout
  /**
   * The sessions of open shell tabs, and the mounted one.
   *
   * @example
   * ```ts
   * const session = ctx.sessions.current()
   * ```
   */
  readonly sessions: Sessions
  /**
   * The mounted session screen and its route-following files, comments and composer. Read it where you act, so an
   * action targets the session routed at that moment; a `MountedSession` carries no such actions.
   *
   * @example
   * ```ts
   * const screen = ctx.screen.current()
   * if (screen) screen.composer.attach({ type: "file", path })
   * ```
   */
  readonly screen: Screen
  /**
   * Stores for keys only known at runtime, and window-local memory. Declare `stores` for keys known up front.
   *
   * @example
   * ```ts
   * const recent = ctx.storage.store(`recent.${server}`, { schema: Recent, initial: { paths: [] } })
   * ```
   */
  readonly storage: Storage
  /**
   * The clipboard, saving files, and opening URLs in the system browser. Works on every platform.
   *
   * @example
   * ```ts
   * await ctx.system.copy(url)
   * ```
   */
  readonly system: System
  /**
   * Desktop-only abilities; undefined on the web.
   *
   * @example
   * ```ts
   * if (!ctx.desktop) return
   * void ctx.desktop.reveal(path)
   * ```
   */
  readonly desktop: Desktop | undefined
  /**
   * Dialogs that close with the owner that opened them, else when the extension goes away.
   *
   * @example
   * ```ts
   * ctx.dialogs.open((dialog) => <ConfirmDialog onDone={dialog.close} />)
   * ```
   */
  readonly dialogs: Dialogs
  /**
   * Routes local links to the extensions that handle them.
   *
   * @example
   * ```ts
   * ctx.links.open({ href: path, session, exact: true })
   * ```
   */
  readonly links: Links
  /**
   * Shows the web pages the main entry created.
   *
   * @example
   * ```ts
   * <ctx.embeds.View id={embed()} visible={visible()} />
   * ```
   */
  readonly embeds: Embeds
  /**
   * The running build.
   *
   * @example
   * ```ts
   * if (ctx.build.channel === "dev") showDebug()
   * ```
   */
  readonly build: Build
  /**
   * The interface language and its writing direction.
   *
   * @example
   * ```ts
   * new Intl.NumberFormat(ctx.locale.locale()).format(count)
   * ```
   */
  readonly locale: Locale
  /**
   * The user's appearance settings.
   *
   * @example
   * ```ts
   * terminal.options.fontFamily = ctx.appearance.font("mono")
   * ```
   */
  readonly appearance: Appearance
  /**
   * The app's route.
   *
   * @example
   * ```ts
   * const onSettings = () => ctx.router.path().startsWith("/settings")
   * ```
   */
  readonly router: Router
  /**
   * The effective keybinds of published commands.
   *
   * @example
   * ```ts
   * const keys = () => ctx.keybinds.keybind(`${ctx.id}.toggle`)
   * ```
   */
  readonly keybinds: Keybinds
  /**
   * The ids of the servers the app lists.
   *
   * @example
   * ```ts
   * const known = () => new Set(ctx.servers.list())
   * ```
   */
  readonly servers: Servers
  /**
   * Workspace lifecycle events.
   *
   * @example
   * ```ts
   * ctx.workspaces.on("remove", (value) => forget(value.server, value.directory))
   * ```
   */
  readonly workspaces: Workspaces
}

type Handle<S> =
  S extends StoreDeclaration<infer Schema, infer Scope>
    ? Scope extends "global"
      ? Persisted<Schema["Type"], Schema["Type"]>
      : (session: SessionRef) => Persisted<Schema["Type"]>
    : never

type Provides<D> = Declared<D, "provides">[keyof Declared<D, "provides">]

/**
 * What `ctx.uses` holds for a token: the provider followed through `Live`. A declared `Ipc.ref` stays pending until
 * the chunk that loads the full token resolves it with `load`.
 */
type Used<T> =
  T extends IpcRef<infer S>
    ? Accessor<Live<IpcClient<S>>> & {
        /** Resolves the reference with its full token, here and in other extensions. Returns this accessor. */
        load(token: Ipc<S>): Accessor<Live<IpcClient<S>>>
      }
    : Accessor<Live<TokenValue<T>>>

/** The context `Setup<typeof Definition>` receives: the host's members, and only the contracts the definition declares. */
export interface SetupContext<D> extends Omit<Context, "provide"> {
  /**
   * Provides a contract the definition declares in `provides`. Withdrawn with the current owner, else with the
   * extension.
   *
   * @param token - A Contract from `provides`.
   * @param impl - Its implementation.
   * @returns Withdraws the contract early.
   *
   * @example
   * ```ts
   * ctx.provide(FileTree, { open: (path) => reveal(path) })
   * ```
   */
  provide<T extends Extract<Provides<D>, Contract<unknown>>>(token: T, impl: TokenValue<T>): Cleanup
  /**
   * Each token of `provides` and each optional dependency of `uses`, by its key, as a `Live` accessor. Branch on it,
   * or follow it with `createKeyed`; an `Ipc.ref` adds `load(fullToken)`. Your own Ipc is here through `provides`.
   *
   * @example
   * ```ts
   * createKeyed(ctx.uses.updater, (client) => void client.on("check", () => act("check")))
   * ```
   */
  readonly uses: { readonly [K in keyof Usable<D>]: Used<Usable<D>[K]> }
  /**
   * Each hard dependency's value, by its name in `requires`. Setup runs only while all are active and restarts when
   * one changes, so the values are plain.
   *
   * @example
   * ```ts
   * ctx.requires.tree.open(path)
   * ```
   */
  readonly requires: { readonly [K in keyof Declared<D, "requires">]: TokenValue<Declared<D, "requires">[K]> }
  /**
   * Each declared window store, by its name in `stores`. A global store is a `Persisted` that has loaded before setup;
   * a session store is a function of the session whose `value` is undefined until that session's store loads. A
   * `Store.main` store belongs to the main entry and is not here.
   *
   * @example
   * ```ts
   * const shown = () => ctx.stores.prefs.value.shown
   * const open = (session: SessionRef) => ctx.stores.view(session).value?.open ?? []
   * ```
   */
  readonly stores: {
    readonly [K in keyof DeclaredStores<D> as DeclaredStores<D>[K] extends MainStoreDeclaration ? never : K]: Handle<
      DeclaredStores<D>[K]
    >
  }
}

/**
 * A window entry: the default export of `renderer.tsx`. `Setup<typeof Definition>` types the context from the
 * definition's declarations. Runs synchronously under the extension's Solid owner; return nothing. Put async work
 * in `createKeyed` or `createLatest`, and pass `ctx.signal` or a signal derived from it.
 * The `undefined` return type rejects async functions and replacement values, while accepting a block with no
 * return. The host also rejects thenables from JavaScript entries and aborts their late work.
 *
 * @param ctx - The extension's declared APIs, dependencies and stores, under its Solid owner.
 *
 * @example
 * ```ts
 * const setup: Setup<typeof definition> = (ctx) => {
 *   ctx.add(Command, { id: "settings", title: ctx.t("settings"), run: () => ctx.layout.settings(ctx.id) })
 * }
 * export default setup
 * ```
 */
export type Setup<D extends Definition> = (ctx: SetupContext<D>) => undefined
