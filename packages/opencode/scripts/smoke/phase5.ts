import { DesignValidatorToolDefinition } from "../../src/tool/design_validator"
import { GitSurgeonToolDefinition } from "../../src/tool/git_surgeon"

async function smokeTest() {
  console.log("Starting Phase 5 Smoke Test...")

  // Mock context
  const ctx = {
    sessionID: "test-session",
    messageID: "test-message",
    metadata: (meta: any) => console.log("Metadata:", meta),
    ask: async () => ({ action: "allow" }),
    extra: {},
  } as any

  console.log("\n--- Testing design_validator ---")
  const designTool = await DesignValidatorToolDefinition.init()
  const designResult = await designTool.execute({ target: "packages/common/ui", fix: true }, ctx)
  console.log("Title:", designResult.title)
  console.log("Output summary:", designResult.output.split("\n")[0])

  console.log("\n--- Testing git_surgeon ---")
  const gitTool = await GitSurgeonToolDefinition.init()
  const gitResult = await gitTool.execute({ action: "resolve_conflicts", strategy: "logical" }, ctx)
  console.log("Title:", gitResult.title)
  console.log("Output summary:", gitResult.output.split("\n")[0])

  console.log("\nPhase 5 Smoke Test Completed Successfully.")
}

smokeTest().catch(console.error)
