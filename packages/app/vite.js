import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"
import { generatePreloadScript } from "@opencode-ai/ui/theme"

/**
 * Vite plugin that injects the theme preload script into index.html.
 * This ensures the theme is applied before the page renders, avoiding FOUC.
 * @type {import("vite").Plugin}
 */
const themePreloadPlugin = {
  name: "opencode-desktop:theme-preload",
  transformIndexHtml(html) {
    const script = generatePreloadScript()
    return html.replace(
      /<script id="oc-theme-preload-script">\s*\/\* THEME_PRELOAD_SCRIPT \*\/\s*<\/script>/,
      `<script id="oc-theme-preload-script">${script}</script>`,
    )
  },
}

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
        worker: {
          format: "es",
        },
      }
    },
  },
  themePreloadPlugin,
  tailwindcss(),
  solidPlugin(),
]
