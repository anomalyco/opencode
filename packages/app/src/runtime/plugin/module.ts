import {
  evaluatePluginBundle,
  inertModule,
  mainOnlyModule,
  readPluginBundle,
  type BundleModule,
  type PluginBundle,
  type PluginModule,
  type Entry,
} from "@opencode/plugin/gui/host"

// Plugin bundles share the host's module instances, so tokens, contexts and schemas they import are the same objects
// the host checks against. In a window, the main SDK's name resolves to the window SDK.
const modules = {
  effect: () => import("effect"),
  "@opencode/plugin/gui": () => import("@opencode/plugin/gui"),
  "@opencode/plugin/gui/main": () => import("@opencode/plugin/gui"),
  "@opencode/plugin/gui/file": () => import("@opencode/plugin/gui/file"),
  "@opencode/plugin/gui/review": () => import("@opencode/plugin/gui/review"),
  "@opencode/plugin/gui/browser": () => import("@opencode/plugin/gui/browser"),
  "@opencode/plugin/rpc": () => import("@opencode/plugin/rpc"),
  "@opencode/schema/rpc": () => import("@opencode/schema/rpc"),
  "@opencode/client": () => import("@opencode/client"),
  "@opencode/client/effect": () => import("@opencode/client/effect"),
  "@opencode/client/solid": () => import("@opencode/client/solid"),
  "solid-js": () => import("solid-js"),
  "solid-js/web": () => import("solid-js/web"),
  "solid-js/store": () => import("solid-js/store"),
} satisfies Record<PluginModule, () => Promise<object>>

/**
 * Builds a host `Entry` for a plugin's `./gui-experimental` bundle, read from the desktop app's own server. The
 * bundle is evaluated here so the host reads its `Plugin.define` declarations (`os`, `stores`, `i18n`) before it
 * activates the plugin. A plugin with only a `main` setup gets an empty window setup, so it still lists as active. It
 * takes the server plugin's id. A bundle that fails to evaluate becomes an entry that fails, so Extensions › Plugins
 * reports it.
 */
export function pluginDefinition(id: string, code: string): Promise<Entry> {
  return definition(id, (require) => evaluatePluginBundle(code, { process: "window", require }))
}

/**
 * `pluginDefinition` for a web tab, whose CSP forbids the `new Function` that `evaluatePluginBundle` uses: the bundle
 * runs as a module imported from a `blob:` URL instead.
 */
export function webPluginDefinition(id: string, code: string): Promise<Entry> {
  return definition(id, async (require) => {
    const run = await importBundle(code)
    const module: BundleModule = { exports: {} }

    run(require, module, module.exports)

    return readPluginBundle(module)
  })
}

async function definition(
  id: string,
  evaluate: (require: (name: string) => object) => PluginBundle | Promise<PluginBundle>,
): Promise<Entry> {
  const loaded = new Map<string, object>(
    await Promise.all(Object.entries(modules).map(async ([name, load]) => [name, await load()] as const)),
  )

  const bundle = await Promise.try(() =>
    evaluate((name) => {
      const module = loaded.get(name)

      if (module) return module

      if (mainOnlyModule(name)) return inertModule(name)

      throw new Error(`Plugin GUI bundle requires a module the app does not share: ${name}`)
    }),
  ).then(
    (value) => ({ ok: true as const, value }),
    (cause: unknown) => ({ ok: false as const, cause }),
  )

  if (!bundle.ok) return { id, windowEntry: () => Promise.reject(bundle.cause) }

  const setup = bundle.value.setup

  // A setup's returned cleanup reaches the host, which runs it when the plugin goes away.
  return { ...bundle.value.definition, id, windowEntry: async () => ({ default: (ctx: never) => setup?.(ctx) }) }
}

// Imports the CommonJS bundle as the body of a function of `require`, `module` and `exports`, the function
// `new Function` would build, so the caller runs it with its own `require`.
function importBundle(code: string) {
  const source = `export default function (require, module, exports) {\n${code}\n}\n`
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }))

  return import(/* @vite-ignore */ url)
    .then((imported: { default: BundleFunction }) => imported.default)
    .finally(() => URL.revokeObjectURL(url))
}

type BundleFunction = (
  require: (name: string) => object,
  module: BundleModule,
  exports: BundleModule["exports"],
) => void
