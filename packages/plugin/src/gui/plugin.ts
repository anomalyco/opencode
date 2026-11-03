import type { SetupContext } from "./context.js"
import type { Cleanup } from "./core.js"
import type { Declarations, Stores } from "./declarations.js"
import type { MainContext } from "./main.js"

export type { Cleanup, Declarations }

/**
 * A window setup: the `setup` of `Plugin.define`. `Plugin.Setup<typeof definition>` types one written apart from
 * its declarations, with `ctx.stores` from the declared stores. Runs synchronously under the plugin's Solid owner;
 * return nothing, or a cleanup that runs when the plugin goes away. Put async work in `createKeyed` or
 * `createLatest`, and pass `ctx.signal` or a signal derived from it. The return type rejects async functions and
 * replacement values; the host also rejects thenables from JavaScript bundles.
 *
 * @param ctx - The plugin's context, under its Solid owner.
 *
 * @example
 * ```ts
 * export default Plugin.define({
 *   setup(ctx) {
 *     ctx.add(Command, () => ({ id: "settings", title: ctx.t("settings"), run: () => ctx.layout.settings(ctx.id) }))
 *   },
 * })
 * ```
 */
export type Setup<D extends Declarations = Declarations<{}>> = (ctx: SetupContext<D>) => Cleanup | void

/**
 * A main-process setup: the `main` of `Plugin.define`. It may be async; return nothing, or a cleanup that runs when
 * the plugin goes away.
 *
 * @param ctx - The plugin's main-process context.
 *
 * @example
 * ```ts
 * export default Plugin.define({
 *   main(ctx) {
 *     const awake = ctx.storage.store("awake", { schema: Schema.Boolean, initial: false })
 *     ctx.provide(KeepAwake, { get: () => awake.value, set: (enabled) => awake.set(enabled) })
 *   },
 * })
 * ```
 */
export type MainSetup = (ctx: MainContext) => Cleanup | void | Promise<Cleanup | void>

/**
 * A plugin's GUI: the default export of its `./gui-experimental` bundle. Its `Declarations`, then a window setup, a
 * main-process setup, or both. The app's built-in plugins declare with it too.
 */
export type Definition<S extends Stores = Stores> = Declarations<S> & {
  /** Runs in every desktop app window. See `Setup`. */
  readonly setup?: Setup<NoInfer<Declarations<S>>>
  /** Runs once in the desktop app's main process. See `MainSetup`. */
  readonly main?: MainSetup
}

/**
 * Defines a plugin's GUI, the default export of its `./gui-experimental` bundle, as `Plugin.define` from
 * `@opencode/plugin` and `@opencode/plugin/tui` define its server and terminal halves. It declares no id: the host
 * assigns the server plugin's (`ctx.id`). The window setup's `ctx.stores` is typed from the declared stores.
 *
 * @param plugin - The declarations and at least one setup.
 * @returns The same object.
 *
 * @example
 * ```tsx
 * export default Plugin.define({
 *   setup(ctx) {
 *     ctx.add(Command, () => ({ id: "open", title: ctx.t("open"), run: () => void ctx.main(Acme).ping() }))
 *   },
 *   main(ctx) {
 *     ctx.provide(Acme, { ping: () => "pong" })
 *   },
 * })
 * ```
 */
export function define<const S extends Stores = {}>(plugin: Definition<S> & WithSetup): Definition<S>
/**
 * Declares a plugin's GUI without setups, so setups written in other files are typed from it
 * (`Plugin.Setup<typeof definition>`) and the app's host lists can attach their own entries. Returns only the
 * declarations.
 *
 * @param plugin - The declarations.
 * @returns The same object.
 */
export function define<const S extends Stores = {}>(plugin: Declarations<S>): Declarations<S>
/**
 * Returns the plugin as it is; the overloads above carry its types.
 *
 * @param plugin - The declarations, with any setups.
 * @returns The same object.
 */
export function define(plugin: Definition) {
  return plugin
}

// A bundle's default export needs a setup; without one, `define` returns only the declarations.
type WithSetup = { readonly setup: unknown } | { readonly main: unknown }
