import { bindings, defineConfig, triggers } from "cf/config"
import { LOCALES } from "../../packages/data/app/src/lib/language"
import { ogWorkerName } from "./og.config"
import { stage, stageAccount, stageHost } from "./stage"

// The data site (packages/data/app, SolidStart) at /data and /<locale>/data on the main host. `--mode dev` deploys
// opencode-data-dev on dev.opencode.ai and `--mode production` opencode-data-production on opencode.ai; any other
// mode throws (stage.ts). The routes are its only way in: it has no custom domain or workers.dev URL. An exact `/data`
// pattern misses `/data?query`, so each pattern is a `/data*` prefix, and route patterns can't wildcard the middle of
// a path, hence one per locale.
// script/build.ts builds this, og.config.ts and sync.config.ts into one Build Output tree.
export default defineConfig(({ mode }) => {
  const current = stage(mode)
  const host = stageHost(current)
  return {
    // Anomaly
    accountId: stageAccount(current),
    worker: {
      name: `opencode-data-${current}`,
      compatibilityDate: "2026-07-25",
      // The Nitro server is built with node compatibility, which also copies string bindings into process.env
      // (packages/data/core/src/resource.ts).
      compatibilityFlags: ["nodejs_compat"],
      env: {
        ASSETS: bindings.assets(),
        // The private Worker that renders Open Graph images (og.config.ts).
        OG_WORKER: bindings.worker({ worker: ogWorkerName(mode) }),
        STAGE: bindings.text(current),
        PUBLIC_URL: bindings.text(`https://${host}/data`),
        // Set from AWS Secrets Manager (opencode/<stage>/DATA_*) by the deploy job.
        DATA_DATABASE_HOST: bindings.secret(),
        DATA_DATABASE_USERNAME: bindings.secret(),
        DATA_DATABASE_PASSWORD: bindings.secret(),
      },
      triggers: ["data", ...LOCALES.map((locale) => `${locale}/data`)].map((prefix) =>
        triggers.fetch({ pattern: `${host}/${prefix}*`, zone: host }),
      ),
      workersDev: false,
      previewUrls: false,
      observability: { enabled: true },
    },
  }
})
