import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createAgentBroadcastTool } from "../../src/tools/agent-broadcast.js"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

function makeCtx(agent: string, dir: string) {
  return {
    sessionID: agent,
    messageID: "m1",
    agent,
    directory: dir,
    worktree: dir,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: (() => {}) as any,
  }
}

describe("agent_broadcast tool", () => {
  let dir: string
  let orch: Orchestrator

  beforeEach(async () => {
    dir = await tmpdir()
    orch = new Orchestrator(dir)
    await orch.start()
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    await orch.spawn({ agent_id: "reviewer", role: "reviewer", capabilities: {} })
  })

  afterEach(async () => {
    orch.stop()
    await cleanup(dir)
  })

  test("broadcasts to all except sender", async () => {
    const tool = createAgentBroadcastTool(orch)
    const result = await tool.execute({ content: "announcement" }, makeCtx("coder", dir))
    expect(result).toContain("1 agents")
  })
})
