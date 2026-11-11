import { defineConfig } from "cf/config"
import { stage } from "./stage"

export const ogWorkerName = (mode: string | undefined) => `opencode-data-og-${stage(mode)}`

// The private Worker that renders the data pages' Open Graph images (packages/data/app/src/og/worker.ts). It has no
// URL or route; the data Worker reaches it through its OG_WORKER Service Binding. It is its own Worker so the data
// Worker doesn't load the Wasm engines and fonts it ships as modules (script/build.ts).
export default defineConfig(({ mode }) => ({
  // Anomaly
  accountId: "15d29c8639fd3733b1b5486a2acfd968",
  worker: {
    name: ogWorkerName(mode),
    compatibilityDate: "2026-07-01",
    workersDev: false,
    previewUrls: false,
    observability: { enabled: true },
  },
}))
