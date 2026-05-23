import { readFileSync } from "node:fs"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"
// FORK: Phase 1 e2e mock plugin [feat: e2e-phase1-mock-mode] 2026-05-23
import e2eMockPlugin from "./vite/e2e-mock.js"

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
            // FORK: DeskFox logo overlay 2026-04-26 — 把 ui 的 logo 重定向到 branding 包
            "@opencode-ai/ui/logo": fileURLToPath(
              new URL("../branding/src/logo.tsx", import.meta.url),
            ),
          },
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
  solidPlugin(),
  // FORK: Phase 1 e2e mock — 仅在 `--mode e2e-mock` / `VITE_E2E_MOCK=true` 时激活
  // [feat: e2e-phase1-mock-mode] 2026-05-23
  e2eMockPlugin(),
]
