import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createSystemPromptHook } from "../../src/hooks/system-prompt.js"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("system prompt hook", () => {
  let dir: string
  let orch: Orchestrator

  beforeEach(async () => {
    dir = await tmpdir()
    orch = new Orchestrator(dir)
    await orch.start()
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
  })

  afterEach(async () => {
    orch.stop()
    await cleanup(dir)
  })

  test("injects team context", async () => {
    const hook = createSystemPromptHook(orch, dir)
    const output: { system: string[] } = { system: [] }
    await hook({ sessionID: "coder", model: {} }, output)
    expect(output.system.length).toBe(1)
    expect(output.system[0]).toContain("coder")
    expect(output.system[0]).toContain("Team Context")
  })

  test("injects team members list", async () => {
    await orch.spawn({ agent_id: "reviewer", role: "reviewer", capabilities: {} })
    const hook = createSystemPromptHook(orch, dir)
    const output: { system: string[] } = { system: [] }
    await hook({ sessionID: "coder", model: {} }, output)
    expect(output.system[0]).toContain("reviewer")
  })

  test("injects rules", async () => {
    const hook = createSystemPromptHook(orch, dir)
    const output: { system: string[] } = { system: [] }
    await hook({ sessionID: "coder", model: {} }, output)
    expect(output.system[0]).toContain("Rules")
    expect(output.system[0]).toContain("agent_share")
  })

  test("no agents → minimal context", async () => {
    const hook = createSystemPromptHook(orch, dir)
    const output: { system: string[] } = { system: [] }
    await hook({ sessionID: "unknown", model: {} }, output)
    expect(output.system.length).toBe(1)
    expect(output.system[0]).toContain("Team Context")
  })
})
