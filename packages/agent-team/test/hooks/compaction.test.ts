import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createCompactionHook } from "../../src/hooks/compaction.js"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("compaction hook", () => {
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

  test("injects team memory context", async () => {
    const hook = createCompactionHook(orch)
    const output: { context: string[]; prompt?: string } = { context: [] }
    await hook({ sessionID: "coder" }, output)
    expect(output.context.length).toBe(1)
    expect(output.context[0]).toContain("Team Memory")
  })

  test("injects current task info", async () => {
    const hook = createCompactionHook(orch)
    const output: { context: string[]; prompt?: string } = { context: [] }
    await hook({ sessionID: "coder" }, output)
    expect(output.context[0]).toContain("Current Task")
  })
})
