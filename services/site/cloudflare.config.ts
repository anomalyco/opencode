import { bindings, defineConfig, triggers } from "cf/config"

// The opencode.ai website (SolidStart). `--mode dev` deploys opencode-site-dev on dev.opencode.ai;
// any other mode deploys opencode-site-production on opencode.ai. It is the catch-all: more specific
// routes on the zone (the V2 docs at /v2* in services/www, Console, inference, changelog, update,
// files, stats, …) keep beating it.
//
// Production takes no routes until the go-live flips this switch (the `production` branch is shared
// with every other service, so an unrelated push must not take the domain).
const productionOwnsRoot = false

export default defineConfig(({ mode }) => {
  const dev = mode === "dev"
  const host = dev ? "dev.opencode.ai" : "opencode.ai"
  return {
    // Anomaly
    accountId: "15d29c8639fd3733b1b5486a2acfd968",
    worker: {
      name: dev ? "opencode-site-dev" : "opencode-site-production",
      compatibilityDate: "2026-07-25",
      // The Nitro server is built with node compatibility (vite.config.ts).
      compatibilityFlags: ["nodejs_compat"],
      assets: {
        htmlHandling: "drop-trailing-slash",
        // Docs pages answer with HTML or Markdown from one URL, so the Worker picks the asset
        // (src/docs/middleware.ts). Search's files are plain assets.
        runWorkerFirst: ["/v2/docs", "/v2/docs/*", "!/v2/docs/pagefind/*"],
      },
      env: {
        ASSETS: bindings.assets(),
        STAGE: bindings.text(dev ? "dev" : "production"),
      },
      triggers:
        dev || productionOwnsRoot
          ? [
              triggers.fetch({ pattern: host, zone: "opencode.ai" }),
              triggers.fetch({ pattern: `${host}/*`, zone: "opencode.ai" }),
            ]
          : [],
      workersDev: false,
      previewUrls: false,
      // Workers Logs: requests, errors and console output, searchable in the Cloudflare dashboard.
      observability: { enabled: true },
    },
  }
})
