import { ModelsDev } from "@opencode-ai/core/models-dev"

// Core is env-free, so the default ModelsDev node refreshes from models.dev
// unless the graph says otherwise. Real-Location fixtures opt out here; the
// test harness refuses any request that slips past.
export const offlineModels = ModelsDev.node.replace(ModelsDev.configured({ fetch: false }))
