import { bindings, defineConfig, triggers } from "cf/config"
import { docsSets } from "./src/docs/config"

// The opencode.ai website (SolidStart). `--mode dev` deploys opencode-site-dev on dev.opencode.ai;
// any other mode deploys opencode-site-production on opencode.ai. It is the catch-all: more specific
// routes on the zone (Console, inference, changelog, update, files, stats, …) keep beating it. It
// also serves the V2 docs at /docs (src/docs).
//
// Production takes no routes until the go-live flips this switch (the `production` branch is shared
// with every other service, so an unrelated push must not take the domain).
const productionOwnsRoot = true

export default defineConfig(({ mode }) => {
  const dev = mode === "dev"
  const host = dev ? "dev.opencode.ai" : "opencode.ai"
  return {
    // Anomaly
    accountId: dev ? "d8e944f537ceef3f06a5bd3aec1d7a53" : "15d29c8639fd3733b1b5486a2acfd968",
    worker: {
      name: dev ? "opencode-site-dev" : "opencode-site-production",
      compatibilityDate: "2026-07-25",
      // The Nitro server is built with node compatibility (vite.config.ts).
      compatibilityFlags: ["nodejs_compat"],
      assets: {
        htmlHandling: "drop-trailing-slash",
        // Docs pages answer with HTML or Markdown from one URL, and a /docs URL without a V2 page
        // goes to the V1 docs, so the Worker picks the asset (src/docs/middleware.ts). The docs' own
        // files (search, stylesheets, images, llms.txt, …) are plain assets.
        runWorkerFirst: docsSets.flatMap((set) => [
          set.base.slice(0, -1),
          `${set.base}*`,
          ...set.files.map((file) => `!${set.base}${file}${file.includes(".") ? "" : "/*"}`),
        ]),
      },
      env: {
        ASSETS: bindings.assets(),
        STAGE: bindings.text(dev ? "dev" : "production"),
      },
      triggers:
        dev || productionOwnsRoot
          ? [
              triggers.fetch({ pattern: host, zone: host }),
              triggers.fetch({ pattern: `${host}/*`, zone: host }),
            ]
          : [],
      // The bare host is a custom domain (it also supplies the DNS record), and cf detaches any domain
      // not listed here. docs.<host> is the old docs host: the Worker sends its URLs to the same path
      // on the V1 docs at /v1/docs.
      domains: [host, `docs.${host}`],
      workersDev: false,
      previewUrls: false,
      // Workers Logs: requests, errors and console output, searchable in the Cloudflare dashboard.
      observability: { enabled: true },
    },
  }
})
