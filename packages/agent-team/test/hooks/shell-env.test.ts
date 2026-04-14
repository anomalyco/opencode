import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createShellEnvHook } from "../../src/hooks/shell-env.js"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("shell env hook", () => {
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

  test("injects agent env vars", async () => {
    const hook = createShellEnvHook(orch)
    const output: { env: Record<string, string> } = { env: {} }
    await hook({ cwd: dir, sessionID: "coder" }, output)
    expect(output.env.AGENT_ID).toBe("coder")
    expect(output.env.AGENT_ROLE).toBe("coder")
    expect(output.env.AGENT_WORKSPACE).toBeTruthy()
    expect(output.env.TEAM_WORKSPACE).toBeTruthy()
  })

  test("no inject for non-agent session", async () => {
    const hook = createShellEnvHook(orch)
    const output: { env: Record<string, string> } = { env: {} }
    await hook({ cwd: dir }, output)
    expect(output.env.AGENT_ID).toBeUndefined()
  })
})
