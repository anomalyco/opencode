import type { Catalog, OS, StoreDeclaration } from "./core.js"

/** The stores a plugin's GUI may declare. */
export type Stores = Readonly<Record<string, StoreDeclaration>>

/**
 * What a plugin's GUI declares: its window state, its copy and the systems it runs on. `Plugin.define` returns this
 * for a definition without setups, so setups in other files are typed from it (`Plugin.Setup<typeof definition>`).
 * The host reads it before any setup runs. The plugin's id is not declared here: the host assigns it (`ctx.id`), from
 * the server plugin for a `./gui-experimental` bundle. Contracts are provided and read at runtime, with `ctx.provide`,
 * `ctx.use` and `ctx.main`.
 */
export interface Declarations<S extends Stores = Stores> {
  /**
   * The operating systems the plugin runs on. Omit it to run on every OS. A plugin from the config runs only in the
   * desktop app; a built-in that lists any OS does not run on the web, where no OS is known.
   */
  readonly os?: readonly OS[]
  /** The plugin's copy. `ctx.t` reads it first, then the app's shared keys such as `common.*`. */
  readonly i18n?: Catalog
  /**
   * Window state the host stores for the plugin, by store name, loaded before it is read. See `Store`. Keys known only
   * at runtime, and every main-process value, go through `ctx.storage.store`.
   */
  readonly stores?: S
}
