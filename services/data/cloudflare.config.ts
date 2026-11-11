import { bindings, defineConfig, triggers } from "cf/config"
import { LOCALES } from "../../packages/stats/app/src/lib/language"
import { ogWorkerName } from "./og.config"

// The data site (packages/stats/app, SolidStart) at /data and /<locale>/data on the main host. `--mode dev` deploys
// opencode-data-dev on dev.opencode.ai; any other mode deploys opencode-data-production on opencode.ai. The routes
// are its only way in: it has no custom domain or workers.dev URL. An exact `/data` pattern misses `/data?query`, so
// each pattern is a `/data*` prefix, and route patterns can't wildcard the middle of a path, hence one per locale.
// script/build.ts builds this, og.config.ts and sync.config.ts into one Build Output tree.
export default defineConfig(({ mode }) => {
  const dev = mode === "dev"
  const stage = dev ? "dev" : "production"
  const host = dev ? "dev.opencode.ai" : "opencode.ai"
  return {
    // Anomaly
    accountId: "15d29c8639fd3733b1b5486a2acfd968",
    worker: {
      name: `opencode-data-${stage}`,
      compatibilityDate: "2026-07-25",
      // The Nitro server is built with node compatibility, which also copies string bindings into process.env
      // (packages/stats/core/src/resource.ts).
      compatibilityFlags: ["nodejs_compat"],
      env: {
        ASSETS: bindings.assets(),
        // The private Worker that renders Open Graph images (og.config.ts).
        OG_WORKER: bindings.worker({ worker: ogWorkerName(mode) }),
        STAGE: bindings.text(stage),
        PUBLIC_URL: bindings.text(`https://${host}/data`),
        // Set from AWS Secrets Manager (opencode/<stage>/DATA_*) by the deploy job.
        DATA_DATABASE_HOST: bindings.secret(),
        DATA_DATABASE_USERNAME: bindings.secret(),
        DATA_DATABASE_PASSWORD: bindings.secret(),
      },
      triggers: ["data", ...LOCALES.map((locale) => `${locale}/data`)].map((prefix) =>
        triggers.fetch({ pattern: `${host}/${prefix}*`, zone: "opencode.ai" }),
      ),
      workersDev: false,
      previewUrls: false,
      observability: { enabled: true },
    },
  }
})
