import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createPermissionHook } from "../../src/hooks/permission.js"
import { createShellEnvHook } from "../../src/hooks/shell-env.js"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

function makePermInput(
  type: string,
  pattern: string | string[],
  sessionID: string,
  metadata?: Record<string, unknown>,
) {
  return {
    id: "p1",
    type,
    pattern,
    sessionID,
    messageID: "m1",
    title: "test",
    metadata: metadata ?? {},
    time: { created: Date.now() },
  }
}

describe("E2E: permission enforcement", () => {
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

  test("agent edit own workspace → allowed", async () => {
    const hook = createPermissionHook(orch)
    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
    const wsPath = `${dir}/.opencode/workspaces/workspace-coder/scratch/file.ts`
    await hook(makePermInput("edit", wsPath, "coder"), output)
    expect(output.status).toBe("ask")
  })

  test("agent edit own worktree → allowed", async () => {
    const hook = createPermissionHook(orch)
    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
    const wtPath = `${dir}/.opencode/workspaces/workspace-coder/.worktrees/feat/file.ts`
    await hook(makePermInput("edit", wtPath, "coder"), output)
    expect(output.status).toBe("ask")
  })

  test("agent edit other agent workspace → denied", async () => {
    const hook = createPermissionHook(orch)
    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
    const otherPath = `${dir}/.opencode/workspaces/workspace-reviewer/scratch/file.ts`
    await hook(makePermInput("edit", otherPath, "coder"), output)
    expect(output.status).toBe("deny")
  })

  test("agent read other agent workspace → denied", async () => {
    const hook = createPermissionHook(orch)
    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
    const otherPath = `${dir}/.opencode/workspaces/workspace-reviewer/scratch/notes.md`
    await hook(makePermInput("read", otherPath, "coder"), output)
    expect(output.status).toBe("deny")
  })

  test("agent run push --force → denied", async () => {
    const hook = createPermissionHook(orch)
    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
    await hook(makePermInput("bash", ["/project"], "coder", { command: "git push --force origin main" }), output)
    expect(output.status).toBe("deny")
  })

  test("agent run reset --hard → denied", async () => {
    const hook = createPermissionHook(orch)
    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
    await hook(makePermInput("bash", ["/project"], "coder", { command: "git reset --hard HEAD~1" }), output)
    expect(output.status).toBe("deny")
  })

  test("non-agent session → pass through", async () => {
    const hook = createPermissionHook(orch)
    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
    await hook(makePermInput("edit", "/any/path", "human-session"), output)
    expect(output.status).toBe("ask")
  })

  test("shell env injected correctly for agent", async () => {
    const hook = createShellEnvHook(orch)
    const output: { env: Record<string, string> } = { env: {} }
    await hook({ cwd: dir, sessionID: "coder" }, output)
    expect(output.env.AGENT_ID).toBe("coder")
    expect(output.env.AGENT_ROLE).toBe("coder")
    expect(output.env.AGENT_WORKSPACE).toContain("workspace-coder")
  })

  test("protected path edit → denied", async () => {
    const hook = createPermissionHook(orch)
    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
    await hook(makePermInput("edit", `${dir}/.opencode/team/state.json`, "coder"), output)
    expect(output.status).toBe("deny")
  })
})
