import { SecurityScannerToolDefinition } from "../../src/tool/security_scanner"
import { ApiSentinelToolDefinition } from "../../src/tool/api_sentinel"
import { Instance } from "../../src/project/instance"

async function smokeTest() {
  console.log("Starting Phase 4 Smoke Test...")

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

      console.log("\n--- Testing security_scanner ---")
      const scanTool = await SecurityScannerToolDefinition.init()
      const scanResult = await scanTool.execute({ target: "packages/opencode/src/tool", level: "quick", fix: false }, ctx)
      console.log("Title:", scanResult.title)
      console.log("Output summary:", scanResult.output.split("\n")[0])

      console.log("\n--- Testing api_sentinel ---")
      const apiTool = await ApiSentinelToolDefinition.init()
      const apiResult = await apiTool.execute({ endpoint: "https://api.example.com/v1", action: "verify_schema" }, ctx)
      console.log("Title:", apiResult.title)
      console.log("Output summary:", apiResult.output.split("\n")[0])
    }
  })

  console.log("\nPhase 4 Smoke Test Completed Successfully.")
}

smokeTest().catch(console.error)
