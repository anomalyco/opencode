import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createToolExecuteBeforeHook, createToolExecuteAfterHook } from "../../src/hooks/tool-guard.js"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("tool.execute.before hook", () => {
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

  test("resolves workspace:// URI in filePath", async () => {
    const hook = createToolExecuteBeforeHook(orch, dir)
    const output = { args: { filePath: `workspace://coder/scratch/file.ts` } }
    await hook({ tool: "edit", sessionID: "coder", callID: "c1" }, output)
    expect(output.args.filePath).toContain("workspace-coder")
    expect(output.args.filePath).not.toContain("workspace://")
  })

  test("resolves team:// URI in path", async () => {
    const hook = createToolExecuteBeforeHook(orch, dir)
    const output = { args: { path: "team://src/index.ts" } }
    await hook({ tool: "read", sessionID: "coder", callID: "c1" }, output)
    expect(output.args.path).toContain("src/index.ts")
    expect(output.args.path).not.toContain("team://")
  })

  test("does not modify args without URI scheme", async () => {
    const hook = createToolExecuteBeforeHook(orch, dir)
    const output = { args: { filePath: "/absolute/path/file.ts" } }
    await hook({ tool: "edit", sessionID: "coder", callID: "c1" }, output)
    expect(output.args.filePath).toBe("/absolute/path/file.ts")
  })
})

describe("tool.execute.after hook", () => {
  test("redacts secrets in output", async () => {
    const dir = await tmpdir()
    const orch = new Orchestrator(dir)
    await orch.start()
    const hook = createToolExecuteAfterHook(orch)
    const output = { title: "", output: "key=sk-1234567890123456789012345678901234567890", metadata: {} }
    await hook({ tool: "bash", sessionID: "coder", callID: "c1", args: {} }, output)
    expect(output.output).toContain("[REDACTED]")
    orch.stop()
    await cleanup(dir)
  })
})
