import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"
import { IOS_INPUT_ZOOM_SCRIPT } from "@opencode/ui/ios-input-zoom"

const theme = fileURLToPath(new URL("./public/oc-theme-preload.js", import.meta.url))
const themeScript = readFileSync(theme, "utf8")
const tailwind = tailwindcss()
const tailwindGenerate = tailwind.find((plugin) => plugin.name === "@tailwindcss/vite:generate:serve")
const tailwindHotUpdate = tailwindGenerate?.hotUpdate

// Tailwind 4.3.3 expects a server that Vite's bundled dev hook does not provide.
if (tailwindGenerate && typeof tailwindHotUpdate === "function") {
  tailwindGenerate.hotUpdate = function (context) {
    if (!context.server) return
    return tailwindHotUpdate.call(this, context)
  }
}

// The markdown worker imports these directly, so they are served unbundled to keep worker startup
// stable. Vite applies `exclude` to every import inside a pre-bundle too, which would leave a bare
// `import "marked"` in mermaid's chunk that the browser cannot resolve from this package.
const workerDeps = ["@shikijs/stream", "marked", "marked-shiki", "remend"]

/** @type {import("rolldown").Plugin} */
const bundleNestedWorkerDeps = {
  name: "opencode-desktop:bundle-nested-worker-deps",
  resolveId(id, importer) {
    if (!importer || !workerDeps.includes(id) || !importer.includes("node_modules")) return
    try {
      return createRequire(importer).resolve(id)
    } catch {
      return
    }
  },
}

export const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "local" || raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (process.env.OPENCODE_CHANNEL === "latest") return "prod"
  return "dev"
})()

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "opencode-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        define: {
          "import.meta.env.VITE_OPENCODE_CHANNEL": JSON.stringify(channel),
        },
        worker: {
          format: "es",
        },
        optimizeDeps: {
          exclude: workerDeps,
          include: ["@opencode/session-ui > mermaid", "@opencode/session-ui > mermaid > katex"],
          rolldownOptions: { plugins: [bundleNestedWorkerDeps] },
        },
      }
    },
  },
  {
    name: "opencode-desktop:ios-input-zoom",
    transformIndexHtml: {
      order: "pre",
      handler: inlineIosInputZoom,
    },
  },
  {
    name: "opencode-desktop:theme-preload",
    transformIndexHtml: {
      order: "pre",
      handler: inlineThemePreload,
    },
  },
  ...tailwind,
  solidPlugin(),
]

export function inlineIosInputZoom(html) {
  return html.replace(
    /<script id="oc-ios-input-zoom-script"><\/script>/,
    `<script id="oc-ios-input-zoom-script">${IOS_INPUT_ZOOM_SCRIPT}</script>`,
  )
}

export function inlineThemePreload(html) {
  return html.replace(
    /<script id="oc-theme-preload-script" src="(?:\.\/|\/)oc-theme-preload\.js"><\/script>/,
    `<script id="oc-theme-preload-script">${themeScript}</script>`,
  )
}
