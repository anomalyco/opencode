import { isBuiltin } from "node:module"
import path from "node:path"
import type { Plugin } from "vite"
import solid from "vite-plugin-solid"
import { pluginSharedModules, pluginWindowModules } from "./modules.js"

/** Where `gui()` reads a plugin's GUI and writes its `./gui-experimental` bundle. */
export interface GuiOptions {
  /** The module whose default export is the plugin's `Plugin.define`. Defaults to `src/gui.tsx`. */
  readonly entry?: string
  /** The CommonJS bundle to write, the file `./gui-experimental` exports. Defaults to `dist/gui-experimental.cjs`. */
  readonly outFile?: string
}

// The modules the app provides to a plugin's GUI, each the app's own instance; the bundle must not include a copy.
const provided = new Set<string>([...pluginSharedModules, ...pluginWindowModules])

/**
 * Builds a plugin's `./gui-experimental` bundle with Vite: compiles Solid JSX, writes one CommonJS file with every
 * dynamic `import()` inlined, since the app loads no second chunk, and keeps the modules the app provides external,
 * with Electron and Node built-ins. Another module of Effect, Solid or OpenCode fails the build: the app does not
 * provide it, and a bundled copy would not share the app's instance.
 *
 * @param options - The entry and the bundle to write.
 * @returns The Vite plugins.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * export default defineConfig({ plugins: [gui()] })
 * ```
 */
export function gui(options: GuiOptions = {}): Plugin[] {
  const outFile = options.outFile ?? "dist/gui-experimental.cjs"

  return [
    solid(),
    {
      name: "opencode-gui",
      enforce: "pre",
      config: () => ({
        build: {
          outDir: path.dirname(outFile),
          emptyOutDir: false,
          lib: {
            entry: options.entry ?? "src/gui.tsx",
            formats: ["cjs"],
            fileName: () => path.basename(outFile),
          },
          rollupOptions: { output: { exports: "named", inlineDynamicImports: true } },
        },
      }),
      resolveId(source) {
        if (provided.has(source) || source === "electron" || isBuiltin(source)) return { id: source, external: true }

        if (/^(effect|solid-js|@opencode)\//.test(source))
          this.error(`${source} is not a module the OpenCode app provides to plugin GUIs: ${[...provided].join(", ")}`)
      },
    },
  ]
}
