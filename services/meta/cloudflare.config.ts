import { bindings, defineConfig, triggers } from "cf/config"
import { PATHS } from "./src/paths.ts"

// `--mode dev` builds and deploys the dev Worker on dev.opencode.ai; any other mode is production on opencode.ai.
// Each path gets its own route, and the routes win over the website's Custom Domain. An exact pattern misses
// `/config.json?query`, and route patterns can't match a query string, so each one is a `<path>*` prefix. No other
// route or site path starts with these, and the Worker 404s anything that isn't exactly one of its paths.
export default defineConfig(({ mode }) => {
  const dev = mode === "dev"
  const host = dev ? "dev.opencode.ai" : "opencode.ai"
  return {
    worker: {
      name: dev ? "opencode-dev-meta" : "opencode-production-meta",
      compatibilityDate: "2026-08-01",
      entrypoint: "./src/index.ts",
      // Assets match only their exact path, so /config.json/ or /tui.json.gz fall through to the Worker's 404.
      assets: { htmlHandling: "none", notFoundHandling: "none" },
      env: {
        ASSETS: bindings.assets(),
      },
      triggers: Object.values(PATHS).map((path) => triggers.fetch({ pattern: `${host}${path}*`, zone: "opencode.ai" })),
      workersDev: false,
      previewUrls: false,
    },
  }
})
