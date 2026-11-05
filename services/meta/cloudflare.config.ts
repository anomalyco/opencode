import { bindings, defineConfig, triggers } from "cf/config"
import { PATHS } from "./src/paths.ts"

// `--mode dev` builds and deploys the dev Worker on dev.opencode.ai; any other mode is production on opencode.ai.
// Each path gets its own exact route so the Worker never catches anything else on the zone. Exact routes win over
// the website's Custom Domain.
export default defineConfig(({ mode }) => {
  const dev = mode === "dev"
  const host = dev ? "dev.opencode.ai" : "opencode.ai"
  return {
    worker: {
      name: dev ? "opencode-dev-meta" : "opencode-production-meta",
      compatibilityDate: "2026-08-01",
      entrypoint: "./src/index.ts",
      assets: {},
      env: {
        ASSETS: bindings.assets(),
      },
      triggers: Object.values(PATHS).map((path) => triggers.fetch({ pattern: `${host}${path}`, zone: "opencode.ai" })),
      workersDev: false,
      previewUrls: false,
    },
  }
})
