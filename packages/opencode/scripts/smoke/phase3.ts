import { LspPowerFixerToolDefinition } from "../../src/tool/lsp_power_fixer"
import { EnvProvisionerToolDefinition } from "../../src/tool/env_provisioner"
import { Instance } from "../../src/project/instance"

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

  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      const ctx: any = {
        sessionID: "test-session",
        messageID: "test-message",
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        metadata: (meta: any) => console.log("Metadata updated:", meta),
        ask: async () => { console.log("Permission requested"); return { action: "allow" } },
      }

      console.log("\n--- Testing lsp_power_fixer ---")
      const lspTool = await LspPowerFixerToolDefinition.init()
      const lspResult = await lspTool.execute({ file: "src/tool/mcp_bridge.ts", action: "quickfix" }, ctx)
      console.log("Title:", lspResult.title)
      console.log("Output summary:", lspResult.output.split("\n")[0])

      console.log("\n--- Testing env_provisioner ---")
      const envTool = await EnvProvisionerToolDefinition.init()
      const envResult = await envTool.execute({ action: "check" }, ctx)
      console.log("Title:", envResult.title)
      console.log("Output summary:", envResult.output.split("\n")[0])
    }
  })

  console.log("\nPhase 3 Smoke Test Completed Successfully.")
}

smokeTest().catch(console.error)
