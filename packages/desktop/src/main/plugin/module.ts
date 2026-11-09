import { createRequire, isBuiltin } from "node:module"
import {
  evaluatePluginBundle,
  inertModule,
  pluginWindowModules,
  type pluginSharedModules,
} from "@opencode/plugin/gui/host"
import type { Plugin } from "@opencode/plugin/gui/main"

const native = createRequire(import.meta.url)

// Plugin bundles share the host's module instances, so tokens and schemas they import are the same objects the host
// checks against. In main, the window SDK's name resolves to the main SDK.
const shared = {
  effect: () => import("effect"),
  "@opencode/plugin/gui": () => import("@opencode/plugin/gui/main"),
  "@opencode/plugin/gui/main": () => import("@opencode/plugin/gui/main"),
  "@opencode/plugin/rpc": () => import("@opencode/plugin/rpc"),
  "@opencode/schema/rpc": () => import("@opencode/schema/rpc"),
  "@opencode/client": () => import("@opencode/client"),
  "@opencode/client/effect": () => import("@opencode/client/effect"),
} satisfies Record<(typeof pluginSharedModules)[number], () => Promise<object>>

const windowOnly = new Set<string>(pluginWindowModules)

/**
 * Evaluates a plugin's `./gui-experimental` bundle in main and returns what main runs: its `Plugin.define`'s `main`
 * setup, or one that does nothing for a plugin with none, and its `os` and catalog. `electron`
 * and Node built-ins are the real modules; the window-only modules are inert placeholders.
 */
export async function evaluateMain(code: string) {
  const modules = new Map<string, object>(
    await Promise.all(Object.entries(shared).map(async ([name, load]) => [name, await load()] as const)),
  )

  const bundle = evaluatePluginBundle(code, {
    process: "main",
    require: (name) => {
      const loaded = modules.get(name)

      if (loaded) return loaded

      if (name === "electron" || isBuiltin(name)) return native(name)

      if (windowOnly.has(name)) return inertModule(name)

      throw new Error(`Plugin GUI bundle requires a module the app does not share: ${name}`)
    },
  })

  return {
    setup: bundle.main ?? ((() => {}) satisfies Plugin.MainSetup),
    i18n: bundle.definition.i18n,
    os: bundle.definition.os,
  }
}
