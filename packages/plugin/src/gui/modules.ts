// The module lists only: `gui()` reads them at build time, so this file imports nothing.

/**
 * The modules a plugin's `./gui-experimental` bundle may require that both processes provide, each its own instance.
 * Main maps `@Mackery6969/plugin/gui` to the main SDK and a window maps `@Mackery6969/plugin/gui/main` to the window SDK:
 * both export the same `Plugin`, `Store`, `Ipc`, `Contract` and `Registry`, so one definition and contract serve both
 * processes. `@Mackery6969/plugin/rpc` is here because a plugin's `./rpc` contract imports it, and its GUI imports that
 * contract.
 */
export const pluginSharedModules = [
  "effect",
  "@Mackery6969/plugin/gui",
  "@Mackery6969/plugin/gui/main",
  "@Mackery6969/plugin/rpc",
  "@Mackery6969/schema/rpc",
  "@Mackery6969/client",
  "@Mackery6969/client/effect",
] as const

/**
 * The modules only a window provides to a plugin's `./gui-experimental` bundle; main gives the bundle an inert
 * placeholder.
 */
export const pluginWindowModules = [
  "solid-js",
  "solid-js/web",
  "solid-js/store",
  "@Mackery6969/plugin/gui/file",
  "@Mackery6969/plugin/gui/review",
  "@Mackery6969/plugin/gui/browser",
  "@Mackery6969/client/solid",
] as const

/** A module name in `pluginSharedModules` or `pluginWindowModules`. */
export type PluginModule = (typeof pluginSharedModules)[number] | (typeof pluginWindowModules)[number]
