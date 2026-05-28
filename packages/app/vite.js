import { readFileSync } from "node:fs"
import react from "@vitejs/plugin-react"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"

const excalidraw = /[/\\]excalidraw[/\\]/

const theme = fileURLToPath(new URL("./public/oc-theme-preload.js", import.meta.url))

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
        optimizeDeps: {
          include: [
            "@blocksuite/presets",
            "@blocksuite/blocks",
            "@blocksuite/store",
            "@blocksuite/block-std",
          ],
        },
        worker: {
          format: "es",
        },
      }
    },
  },
  {
    name: "opencode-desktop:theme-preload",
    transformIndexHtml(html) {
      return html.replace(
        '<script id="oc-theme-preload-script" src="/oc-theme-preload.js"></script>',
        `<script id="oc-theme-preload-script">${readFileSync(theme, "utf8")}</script>`,
      )
    },
  },
  tailwindcss(),
  react({ include: excalidraw }),
  solidPlugin({ exclude: excalidraw }),
]
