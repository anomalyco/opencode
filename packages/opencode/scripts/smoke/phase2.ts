import { PerfProfilerToolDefinition } from "../../src/tool/perf_profiler"
import { DbExplorerToolDefinition } from "../../src/tool/db_explorer"

async function smokeTest() {
  console.log("Starting Phase 2 Smoke Test...")

  // Mock context
  const ctx = {
    sessionID: "test-session",
    messageID: "test-message",
    metadata: (meta: any) => console.log("Metadata:", meta),
    ask: async () => ({ action: "allow" }),
    extra: {},
  } as any

  console.log("\n--- Testing perf_profiler ---")
  const perfTool = await PerfProfilerToolDefinition.init()
  const perfResult = await perfTool.execute({ target: "api/v1/users", mode: "cpu", duration: 5000 }, ctx as any)
  console.log("Title:", perfResult.title)
  console.log("Output summary:", perfResult.output.split("\n")[0])

  console.log("\n--- Testing db_explorer ---")
  const dbTool = await DbExplorerToolDefinition.init()
  const dbResult = await dbTool.execute({ action: "list_tables" }, ctx as any)
  console.log("Title:", dbResult.title)
  console.log("Output summary:", dbResult.output.split("\n")[0])

  console.log("\nPhase 2 Smoke Test Completed Successfully.")
}

smokeTest().catch(console.error)
