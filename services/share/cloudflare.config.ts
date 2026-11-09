import { defineConfig } from "cf/config"

// Deprecated: session sharing is retired and V2 has no sharing; delete this service once old links and V1
// clients no longer need an answer. opncd.ai is the retired session-sharing hostname. The Worker only answers the tombstone page and the
// V1 share API stubs, so it deploys on its own instead of through SST.
export default defineConfig(({ mode }) => {
  const dev = mode === "dev"
  return {
    // Anomaly
    accountId: "15d29c8639fd3733b1b5486a2acfd968",
    worker: {
      name: dev ? "opencode-share-dev" : "opencode-share-production",
      compatibilityDate: "2026-07-25",
      entrypoint: "./src/index.ts",
      domains: [dev ? "dev.opncd.ai" : "opncd.ai"],
      workersDev: false,
      previewUrls: false,
      observability: { enabled: true },
    },
  }
})
