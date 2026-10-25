import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"

const theme = fileURLToPath(new URL("./public/oc-theme-preload.js", import.meta.url))

const channel = (() => {
  const raw = process.env.BOLT_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  if (process.env.BOLT_CHANNEL === "latest") return "prod"
  return "dev"
})()

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "bolt-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
            // The font package imports its 33 MB Chinese, Japanese and Korean add-on on demand; the app does not ship it.
            "@betteroffice/fonts-cjk": fileURLToPath(
              new URL("../gui-extensions/src/microsoft-office/fonts-cjk.ts", import.meta.url),
            ),
          },
        },
        define: {
          "import.meta.env.VITE_BOLT_CHANNEL": JSON.stringify(channel),
        },
        worker: {
          format: "es",
        },
        optimizeDeps: {
          exclude: [...workerDeps, ...officeDeps],
          rolldownOptions: { plugins: [bundleNestedWorkerDeps] },
        },
      }
    },
  },
  dropUnloadedOfficeFiles,
  {
    name: "bolt-desktop:theme-preload",
    transformIndexHtml(html) {
      return html.replace(
        '<script id="oc-theme-preload-script" src="/oc-theme-preload.js"></script>',
        `<script id="oc-theme-preload-script">${readFileSync(theme, "utf8")}</script>`,
      )
    },
  },
  ...tailwind,
  solidPlugin(),
]

export function inlineThemePreload(html) {
  return html.replace(
    /<script id="oc-theme-preload-script" src="(?:\.\/|\/)oc-theme-preload\.js"><\/script>/,
    `<script id="oc-theme-preload-script">${themeScript}</script>`,
  )
}
