import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createAgentListTool } from "../../src/tools/agent-list.js"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("agent_list tool", () => {
  let dir: string
  let orch: Orchestrator

  beforeEach(async () => {
    dir = await tmpdir()
    orch = new Orchestrator(dir)
    await orch.start()
  })

  afterEach(async () => {
    orch.stop()
    await cleanup(dir)
  })

  test("returns formatted table of agents", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    const tool = createAgentListTool(orch)
    const result = await tool.execute(
      {},
      {
        sessionID: "s1",
        messageID: "m1",
        agent: "coder",
        directory: dir,
        worktree: dir,
        abort: new AbortController().signal,
        metadata: () => {},
        ask: (() => {}) as any,
      },
    )
    expect(result).toContain("coder")
  })

  test("returns 'No agents' for empty team", async () => {
    const tool = createAgentListTool(orch)
    const result = await tool.execute(
      {},
      {
        sessionID: "s1",
        messageID: "m1",
        agent: "test",
        directory: dir,
        worktree: dir,
        abort: new AbortController().signal,
        metadata: () => {},
        ask: (() => {}) as any,
      },
    )
    expect(result).toContain("No agents")
  })
})
