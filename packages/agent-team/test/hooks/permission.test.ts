import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createPermissionHook } from "../../src/hooks/permission.js"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

function makeInput(type: string, pattern: string | string[], sessionID: string, metadata?: Record<string, unknown>) {
  return {
    id: "p1",
    type,
    pattern,
    sessionID,
    messageID: "m1",
    title: "test",
    metadata: metadata ?? {},
    time: Date.now(),
  }
}

describe("permission hook", () => {
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

  test("allows own workspace edit", async () => {
    const hook = createPermissionHook(orch)
    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
    const wsPath = `${dir}/.opencode/workspaces/workspace-coder/file.ts`
    await hook(makeInput("edit", wsPath, "coder"), output)
    expect(output.status).toBe("ask")
  })

  test("denies other agent workspace edit", async () => {
    const hook = createPermissionHook(orch)
    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
    const otherPath = `${dir}/.opencode/workspaces/workspace-reviewer/file.ts`
    await hook(makeInput("edit", otherPath, "coder"), output)
    expect(output.status).toBe("deny")
  })

  test("denies protected path edit", async () => {
    const hook = createPermissionHook(orch)
    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
    await hook(makeInput("edit", `${dir}/.opencode/team/state.json`, "coder"), output)
    expect(output.status).toBe("deny")
  })

  test("denies dangerous bash command", async () => {
    const hook = createPermissionHook(orch)
    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
    await hook(makeInput("bash", ["/some/path"], "coder", { command: "git push --force" }), output)
    expect(output.status).toBe("deny")
  })

  test("passes through for non-agent session", async () => {
    const hook = createPermissionHook(orch)
    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
    await hook(makeInput("edit", "/some/path", "unknown-session"), output)
    expect(output.status).toBe("ask")
  })
})
