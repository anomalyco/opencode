import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createAgentSendTool } from "../../src/tools/agent-send.js"
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

describe("agent_send tool", () => {
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

  test("sends message to target", async () => {
    const tool = createAgentSendTool(orch)
    const result = await tool.execute({ target: "reviewer", content: "hello", type: "message" }, makeCtx("coder", dir))
    expect(result).toContain("sent")
  })

  test("error when target not found", async () => {
    const tool = createAgentSendTool(orch)
    const result = await tool.execute({ target: "unknown", content: "hello", type: "message" }, makeCtx("coder", dir))
    expect(result).toContain("not found")
  })

  test("error when sending to self", async () => {
    const tool = createAgentSendTool(orch)
    const result = await tool.execute({ target: "coder", content: "hello", type: "message" }, makeCtx("coder", dir))
    expect(result).toContain("yourself")
  })
})
