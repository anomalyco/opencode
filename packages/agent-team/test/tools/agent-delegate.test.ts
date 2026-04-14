import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createAgentDelegateTool } from "../../src/tools/agent-delegate.js"
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

describe("agent_delegate tool", () => {
  let dir: string
  let orch: Orchestrator

  beforeEach(async () => {
    dir = await tmpdir()
    orch = new Orchestrator(dir)
    await orch.start()
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: { tools: ["read", "edit"] } })
  })

  afterEach(async () => {
    orch.stop()
    await cleanup(dir)
  })

  test("delegates task without session returns error", async () => {
    const tool = createAgentDelegateTool(orch)
    const result = await tool.execute({ target: "coder", title: "Test", description: "Do test" }, makeCtx("human", dir))
    expect(result).toContain("Error")
  })

  test("delegates task with mock client session", async () => {
    const mockClient = {
      session: {
        create: async () => ({ data: { id: "sess-1" } }),
        prompt: async () => ({ data: { parts: [{ type: "text", text: "Task done!" }] } }),
      },
    }
    orch.setClient(mockClient as any)
    const tool = createAgentDelegateTool(orch)
    const result = await tool.execute({ target: "coder", title: "Test", description: "Do test" }, makeCtx("human", dir))
    expect(result).toContain("Task done!")
  })

  test("error when target not found", async () => {
    const tool = createAgentDelegateTool(orch)
    const result = await tool.execute(
      { target: "unknown", title: "Test", description: "Do test" },
      makeCtx("human", dir),
    )
    expect(result).toContain("not found")
  })

  test("error when capability missing", async () => {
    const tool = createAgentDelegateTool(orch)
    const result = await tool.execute(
      { target: "coder", title: "Test", description: "Do test", required_capabilities: ["nonexistent"] },
      makeCtx("human", dir),
    )
    expect(result).toContain("capabilities")
  })
})
