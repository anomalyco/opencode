export default {
  accountId: "15d29c8639fd3733b1b5486a2acfd968",
  worker: {
    name: "opencode-v1-webapprouterscript",
    compatibilityDate: "2025-05-05",
    domains: ["app.opencode.ai"],
    workersDev: false,
    previewUrls: false,
    assets: { htmlHandling: "none", runWorkerFirst: true },
    env: {
      ASSETS: { type: "assets" },
      LEGACY: { type: "kv", id: "33afbba643a2403992173df6c0be1c18" },
    },
  },
}
