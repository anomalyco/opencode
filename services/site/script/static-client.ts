import { readFile, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build, type Plugin } from "vite"
import solid from "vite-plugin-solid"
import { cssVariantsForProduction, devOnlyCss } from "./css-variants-plugin"
import { foldSettingsForProduction } from "./fold-settings"
import { i18nSlices } from "./i18n-plugin"
import { group } from "./stylesheet-groups"

const root = fileURLToPath(new URL("..", import.meta.url))
const entry = "src/client/entry.ts"
const manifest = ".vite/static-manifest.json"
const virtual = "virtual:static-client"

/**
 * The static pages' script (src/client/entry.ts, with the islands and overlays it loads) in a build
 * of its own, as the docs build theirs (src/docs/script/build.ts): the only JavaScript production
 * serves, since every page is static there (src/static/render.tsx). The app's browser build still
 * runs, for the stylesheets every page links (the shell's and each group's, script/stylesheet-groups.ts)
 * and the manifest the Worker finds them in, but its scripts, which only hydration would load, are
 * deleted once it is written. Then this runs, beside its files, and the Worker's build after it reads
 * the script's file name from `virtual:static-client`. A stylesheet already in the shell's or a
 * group's file is on the page, so this build leaves it empty; the ones loaded on demand (search, the
 * Markdown view) come with their code.
 */
export function staticClient(): Plugin {
  let script: string | undefined
  return {
    name: "static-client",
    resolveId: (id) => (id === virtual ? `\0${virtual}` : undefined),
    // Development renders no static pages (src/static/routes.ts), so it has no script.
    load: (id) => (id === `\0${virtual}` ? `export default ${JSON.stringify(script ?? null)}` : undefined),
    async writeBundle(options, bundle) {
      if (this.environment.name !== "client" || !options.dir) return
      // The app's own scripts: no production page loads them.
      const dir = options.dir
      await Promise.all(
        Object.values(bundle)
          .filter((file) => /\.m?js(\.map)?$/.test(file.fileName))
          .map((file) => rm(path.join(dir, file.fileName))),
      )
      const shown = new Set(
        [...this.getModuleIds()].filter(
          (id) =>
            /\.css(\?|$)/.test(id) &&
            group(id, (module) => this.getModuleInfo(module) as { importers: string[] } | null) !== null,
        ),
      )
      await build({
        configFile: false,
        root,
        publicDir: false,
        logLevel: "warn",
        resolve: { alias: { "~": path.join(root, "src") } },
        plugins: [
          {
            name: "static-client-shown-css",
            enforce: "pre",
            async resolveId(source, importer) {
              if (!/\.css(\?|$)/.test(source)) return
              const resolved = await this.resolve(source, importer, { skipSelf: true })
              return resolved && shown.has(resolved.id) ? "\0static-client-shown.css.js" : undefined
            },
            load: (id) => (id === "\0static-client-shown.css.js" ? "export {}" : undefined),
          },
          // As in vite.config.ts: production's settings, and the CSS for them only.
          foldSettingsForProduction(),
          // Rendered in the browser only, never hydrated.
          solid({ solid: { hydratable: false } }),
          devOnlyCss(),
          cssVariantsForProduction(),
          i18nSlices(),
        ],
        build: {
          outDir: options.dir,
          emptyOutDir: false,
          copyPublicDir: false,
          // Beside the app's hashed files, so they're cached and kept for open pages the same way.
          assetsDir: "_build/assets",
          manifest,
          minify: "oxc",
          // As in vite.config.ts: hidden source maps for strobe's profiles.
          sourcemap: process.env.STROBE_SOURCEMAP === "hidden" ? "hidden" : undefined,
          cssMinify: true,
          // vite.config.ts's target: keeps light-dark() native.
          cssTarget: ["chrome123", "edge123", "firefox120", "safari17.5"],
          rolldownOptions: { input: [entry] },
        },
      })
      const files: Record<string, { file: string }> = JSON.parse(
        await readFile(path.join(options.dir, manifest), "utf8"),
      )
      script = `/${files[entry].file}`
    },
  }
}
