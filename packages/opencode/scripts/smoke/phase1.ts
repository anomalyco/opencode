import { RepoArchitectToolDefinition } from "../../src/tool/repo_architect"
import { McpBridgeToolDefinition } from "../../src/tool/mcp_bridge"
import { Instance } from "../../src/project/instance"

async function smokeTest() {
  console.log("Starting Phase 1 Smoke Test...")

  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      // Proper Tool.Context mock
      const ctx: any = {
        sessionID: "test-session",
        messageID: "test-message",
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        metadata: (meta: any) => console.log("Metadata updated:", meta),
        ask: async () => { console.log("Permission requested"); return { action: "allow" } },
      }

      console.log("\n--- Testing repo_architect ---")
      const archTool = await RepoArchitectToolDefinition.init()
      const archResult = await archTool.execute({ depth: 2, format: "text" }, ctx)
      console.log("Title:", archResult.title)
      console.log("Output summary:", archResult.output.split("\n")[0])

      console.log("\n--- Testing mcp_bridge ---")
      const mcpTool = await McpBridgeToolDefinition.init()
      const mcpResult = await mcpTool.execute({ server_name: "test-server", action: "list_tools" }, ctx)
      console.log("Title:", mcpResult.title)
      console.log("Output:", mcpResult.output)
    }
  })

  console.log("\nPhase 1 Smoke Test Completed Successfully.")
}

smokeTest().catch(console.error)
