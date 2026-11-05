import { bindings, defineConfig, triggers } from "cf/config"

// The opencode.ai website: the site (site/, SolidStart) and the V2 docs (src/, Astro, under /v2) in
// one Worker. `--mode dev` deploys opencode-www-dev on dev.opencode.ai; any other mode deploys
// opencode-www-production on opencode.ai. More specific routes on the zone (Console, inference,
// changelog, update, files, …) keep beating the catch-all.
//
// Production keeps only today's /v2* route until the go-live flips this switch (the `production`
// branch is shared with every other service, so an unrelated push must not take the domain).
const productionOwnsRoot = false

export default defineConfig(({ mode }) => {
  const dev = mode === "dev"
  const host = dev ? "dev.opencode.ai" : "opencode.ai"
  const ownsRoot = dev || productionOwnsRoot
  return {
    // Anomaly
    accountId: "15d29c8639fd3733b1b5486a2acfd968",
    worker: {
      name: dev ? "opencode-www-dev" : "opencode-www-production",
      compatibilityDate: "2026-07-25",
      // The site's Nitro server is built with node compatibility (site/vite.config.ts).
      compatibilityFlags: ["nodejs_compat"],
      entrypoint: "./worker.ts",
      assets: { htmlHandling: "drop-trailing-slash" },
      env: {
        ASSETS: bindings.assets(),
        STAGE: bindings.text(dev ? "dev" : "production"),
      },
      triggers: [
        triggers.fetch({ pattern: `${host}/v2*`, zone: "opencode.ai" }),
        ...(ownsRoot
          ? [
              triggers.fetch({ pattern: host, zone: "opencode.ai" }),
              triggers.fetch({ pattern: `${host}/*`, zone: "opencode.ai" }),
            ]
          : []),
      ],
      cache: { enabled: true },
      workersDev: false,
      previewUrls: false,
    },
  }
})
