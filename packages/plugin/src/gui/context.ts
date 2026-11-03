import type { Accessor } from "solid-js"
import type {
  BaseContext,
  App,
  Cleanup,
  Contract,
  DeclaredStores,
  Ipc,
  IpcClient,
  IpcSpec,
  Live,
  Persisted,
  StoreDeclaration,
  Token,
  TokenValue,
} from "./core.js"
import type {
  Appearance,
  Attention,
  Commands,
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
  Tabs,
  Toasts,
  Ui,
  Workspaces,
} from "./host-apis.js"

/**
 * What every window entry gets. Contracts are provided and read at runtime: `ctx.provide` for your own, `ctx.use` for
 * other plugins', `ctx.main` for your main process. The APIs the host always provides are properties, each created
 * on first read.
 * Setup runs under the plugin's root owner: Solid's `onCleanup` in setup runs when the plugin goes away.
 * `usePlugin()` returns the same object inside contributions.
 */
export interface Context extends BaseContext {
  /**
   * Provides an in-process contract. Withdrawn with the current owner, else with the plugin. Throws for a contract
   * whose id is not your plugin's id or under it (`<id>.<name>`), and for an Ipc token: Ipcs are provided by the main
   * entry.
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
  provide<C extends Contract<unknown>>(token: C, impl: TokenValue<C>): Cleanup
  /**
   * Follows a contract or an Ipc that another plugin provides. Returns a `Live` accessor: pending while its provider
   * loads, active with its value, inactive while it is turned off or failed. The plugin must keep working while it is
   * inactive. Branch on it, or follow it with `createKeyed`. The provider is the plugin whose id the token's id names.
   *
   * @param token - The contract or Ipc.
   * @returns The provider as a `Live` accessor; the same accessor for every call with the token.
   *
   * @example
   * ```ts
   * createKeyed(ctx.use(Changes), (changes) => changes.watch(screen, "files"))
   * ```
   */
  use<T extends Token>(token: T): Accessor<Live<TokenValue<T>>>
  /**
   * The client of an Ipc your own main entry provides. A call waits while the main entry starts, and rejects when it
   * cannot answer: on the web, while the plugin's main entry is off or failed, or when main throws. A call waits
   * indefinitely when the plugin has no main entry. `state` and `on`
   * follow the main entry across restarts. Throws for an Ipc whose id is not your plugin's id or under it.
   *
   * @param token - The Ipc.
   * @returns Its client; the same client for every call with the token.
   *
   * @example
   * ```ts
   * const awake = ctx.main(KeepAwake)
   * ctx.add(Command, { id: "awake", title: ctx.t("awake"), run: () => void awake.set(true) })
   * ```
   */
  main<S extends IpcSpec>(token: Ipc<S>): IpcClient<S>
  /**
   * Side panel tabs, scroll offsets, and the settings and project dialogs.
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
   * Dialogs that close with the owner that opened them, else when the plugin goes away.
   *
   * @example
   * ```ts
   * ctx.dialogs.open((dialog) => <ConfirmDialog onDone={dialog.close} />)
   * ```
   */
  readonly dialogs: Dialogs
  /**
   * Short messages in a corner of the window. A plugin's toasts close when it goes away.
   *
   * @example
   * ```ts
   * const saving = ctx.toast.show({ title: ctx.t("saving"), variant: "loading", persistent: true })
   * await save()
   * saving.dismiss()
   * ```
   */
  readonly toast: Toasts
  /**
   * The shell's tab strip: open, show, move and close session tabs.
   *
   * @example
   * ```ts
   * const first = (key: string) => ctx.tabs.move(key, 0)
   * ```
   */
  readonly tabs: Tabs
  /**
   * System notifications and sounds that follow the user's notification settings, for when they look elsewhere.
   *
   * @example
   * ```ts
   * void ctx.attention.notify({ title: ctx.t("tests.done"), session: { server: session.server.id, id: session.id } })
   * ```
   */
  readonly attention: Attention
  /**
   * Runs published plugin commands and the app's own, as the command palette does.
   *
   * @example
   * ```ts
   * if (!ctx.commands.run("terminal.toggle")) ctx.toast.show({ title: ctx.t("terminal.unavailable") })
   * ```
   */
  readonly commands: Commands
  /**
   * Routes local links to the plugins that handle them.
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
   * The app's own components: icons, buttons, tooltips, menus, the loading indicator, the dialog frame, switches,
   * text fields, keybind chips, Markdown and highlighted code.
   *
   * @example
   * ```tsx
   * <ctx.ui.Button icon="check" onClick={apply}>{ctx.t("apply")}</ctx.ui.Button>
   * ```
   */
  readonly ui: Ui
  /**
   * The running app: its version, release channel and platform, as `ctx.app` in server and TUI plugins.
   *
   * @example
   * ```ts
   * if (ctx.app.channel === "dev") showDebug()
   * ```
   */
  readonly app: App
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
   * The servers the app lists: their ids, and each one's live `ServerRef`.
   *
   * @example
   * ```ts
   * const known = () => new Set(ctx.servers.list())
   * const server = (id: string) => ctx.servers.get(id)
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

/** The context `Plugin.Setup<typeof definition>` receives: the host's members, and the definition's declared stores. */
export interface SetupContext<D> extends Context {
  /**
   * Each declared store, by its name in `stores`. A global store is a `Persisted` that has loaded before setup; a
   * session store is a function of the session whose `value` is undefined until that session's store loads.
   *
   * @example
   * ```ts
   * const shown = () => ctx.stores.prefs.value.shown
   * const open = (session: SessionRef) => ctx.stores.view(session).value?.open ?? []
   * ```
   */
  readonly stores: { readonly [K in keyof DeclaredStores<D>]: Handle<DeclaredStores<D>[K]> }
}
