import { LspPowerFixerToolDefinition } from "../../src/tool/lsp_power_fixer"
import { EnvProvisionerToolDefinition } from "../../src/tool/env_provisioner"

async function smokeTest() {
  console.log("Starting Phase 3 Smoke Test...")

  // Mock context
  const ctx = {
    sessionID: "test-session",
    messageID: "test-message",
    metadata: (meta: any) => console.log("Metadata:", meta),
    ask: async () => ({ action: "allow" }),
    extra: {},
  } as any

  console.log("\n--- Testing lsp_power_fixer ---")
  const lspTool = await LspPowerFixerToolDefinition.init()
  const lspResult = await lspTool.execute({ file: "src/tool/mcp_bridge.ts", action: "quickfix" }, ctx as any)
  console.log("Title:", lspResult.title)
  console.log("Output summary:", lspResult.output.split("\n")[0])

  console.log("\n--- Testing env_provisioner ---")
  const envTool = await EnvProvisionerToolDefinition.init()
  const envResult = await envTool.execute({ action: "check" }, ctx as any)
  console.log("Title:", envResult.title)
  console.log("Output summary:", envResult.output.split("\n")[0])

  console.log("\nPhase 3 Smoke Test Completed Successfully.")
}

smokeTest().catch(console.error)
