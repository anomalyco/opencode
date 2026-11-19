import { loadConfig } from "./config"
import { createHarness, type HarnessState } from "./server"
import { registerShoppingTools } from "./tools/enrich"

const config = loadConfig()
registerShoppingTools()

const state: HarnessState = { startedAt: Date.now() }

const server = Bun.serve({
  port: config.port,
  hostname: config.hostname,
  fetch: createHarness(config, state),
})

console.log(`wb-harness listening on http://${server.hostname}:${server.port}`)
console.log(`  POST /v1/chat/completions   OpenAI-compatible`)
console.log(`  POST /api/chat/v5/message   Wildberries-native proxy`)
console.log(`  GET  /health`)
if (!config.auth.token || !config.auth.userdata) {
  console.warn("WB_TOKEN / WB_USERDATA are not set — requests will fail with 401")
}
