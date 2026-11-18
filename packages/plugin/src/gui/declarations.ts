import type { Catalog, OS, StoreDeclaration } from "./core.js"

/** The stores a plugin's GUI may declare. */
export type Stores = Readonly<Record<string, StoreDeclaration>>

/** The icons a plugin's GUI may declare: each icon's SVG document, by the icon's name. */
export type Icons = Readonly<Record<string, string>>

/**
 * What a plugin's GUI declares: its window state, its icons, its copy and the systems it runs on. `Plugin.define`
 * returns this for a definition without setups, so setups in other files are typed from it
 * (`Plugin.Setup<typeof definition>`). The host reads it before any setup runs. The plugin's id is not declared here:
 * the host assigns it (`ctx.id`), from the server plugin for a `./gui-experimental` bundle. Contracts are provided and
 * read at runtime, with `ctx.provide`, `ctx.use` and `ctx.main`.
 */
export interface Declarations<S extends Stores = Stores, I extends Icons = Icons> {
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
  /**
   * The plugin's own icons, by name, for artwork the app's icon catalog does not have. Each value is an SVG document
   * as text, as a design tool exports it; a bundle built with `gui()` imports the file with `?raw`. The host registers
   * them before setup, and `ctx.icons` gives each one's name for every SDK icon field and for `ctx.ui.Icon`. A value
   * that is not an SVG document fails the plugin when it starts.
   * - The document's `viewBox` frames the drawing, else its `width` and `height`. The host scales the drawing to the
   *   place that shows it, so draw on the app's 16px grid.
   * - Draw with `currentColor`: the icon takes the color of the place that shows it, such as a pill's `tone`.
   * - A drawing may move with SVG animation elements (`animate`, `animateTransform`). Every place that shows the icon
   *   moves in step, and the animation goes on while the host renders that place again. Under the user's reduced
   *   motion setting the host holds the icon on its first frame, so make that frame the resting drawing.
   * - An `id` in the drawing is the whole window's; keep it unique, or leave it out.
   *
   * @example
   * ```ts
   * import logo from "./logo.svg?raw"
   *
   * export default Plugin.define({ icons: { logo }, setup })
   * ```
   */
  readonly icons?: I
}
