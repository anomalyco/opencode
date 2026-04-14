import { Orchestrator } from "../../src/orchestrator/index.js"
import { tmpdir } from "./workspace.js"

export async function createTestOrchestrator(
  config?: Record<string, unknown>,
): Promise<{ orch: Orchestrator; dir: string; cleanup: () => Promise<void> }> {
  const dir = await tmpdir()
  const orch = new Orchestrator(dir, config)
  await orch.start()
  return {
    orch,
    dir,
    cleanup: async () => {
      orch.stop()
      const { cleanup } = await import("./workspace.js")
      await cleanup(dir)
    },
  }
}
