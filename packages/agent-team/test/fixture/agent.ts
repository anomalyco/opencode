import { tmpdir, cleanup } from "./workspace.js"

export async function createTestAgent(agentId: string) {
  const dir = await tmpdir()
  return {
    id: agentId,
    dir,
    cleanup: () => cleanup(dir),
  }
}
