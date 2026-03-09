import { PerfProfilerToolDefinition } from "../../src/tool/perf_profiler"
import { DbExplorerToolDefinition } from "../../src/tool/db_explorer"
import { Instance } from "../../src/project/instance"

async function smokeTest() {
  console.log("Starting Phase 2 Smoke Test...")

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

      console.log("\n--- Testing perf_profiler ---")
      const perfTool = await PerfProfilerToolDefinition.init()
      const perfResult = await perfTool.execute({ target: "api/v1/users", mode: "cpu", duration: 5000 }, ctx)
      console.log("Title:", perfResult.title)
      console.log("Output summary:", perfResult.output.split("\n")[0])

      console.log("\n--- Testing db_explorer ---")
      const dbTool = await DbExplorerToolDefinition.init()
      const dbResult = await dbTool.execute({ action: "list_tables" }, ctx)
      console.log("Title:", dbResult.title)
      console.log("Output summary:", dbResult.output.split("\n")[0])
    }
  })

  console.log("\nPhase 2 Smoke Test Completed Successfully.")
}

smokeTest().catch(console.error)
