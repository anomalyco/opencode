import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("E2E: agent lifecycle", () => {
  let dir: string
  let orch: Orchestrator

  beforeEach(async () => {
    dir = await tmpdir()
    orch = new Orchestrator(dir, { maxAgents: 3 })
    await orch.start()
  })

  afterEach(async () => {
    orch.stop()
    await cleanup(dir)
  })

  test("spawn assigns id and registers agent", async () => {
    const id = await orch.spawn({ role: "coder", capabilities: { tools: ["edit"] } })
    expect(id).toBeTruthy()
    const info = orch.getInfo(id)
    expect(info?.role).toBe("coder")
    expect(info?.status).toBe("idle")
    expect(info?.capabilities.tools).toContain("edit")
  })

  test("spawn with custom agent_id", async () => {
    const id = await orch.spawn({ agent_id: "my-coder", role: "coder", capabilities: {} })
    expect(id).toBe("my-coder")
  })

  test("spawn rejects duplicate agent_id", async () => {
    await orch.spawn({ agent_id: "dup", role: "coder", capabilities: {} })
    expect(async () => {
      await orch.spawn({ agent_id: "dup", role: "coder", capabilities: {} })
    }).toThrow()
  })

  test("max agents enforced", async () => {
    await orch.spawn({ agent_id: "a1", role: "worker", capabilities: {} })
    await orch.spawn({ agent_id: "a2", role: "worker", capabilities: {} })
    await orch.spawn({ agent_id: "a3", role: "worker", capabilities: {} })
    await expect(orch.spawn({ agent_id: "a4", role: "worker", capabilities: {} })).rejects.toThrow("Max agents")
  })

  test("max agents counts only non-dead agents", async () => {
    await orch.spawn({ agent_id: "a1", role: "worker", capabilities: {} })
    await orch.spawn({ agent_id: "a2", role: "worker", capabilities: {} })
    await orch.spawn({ agent_id: "a3", role: "worker", capabilities: {} })
    await orch.terminate("a1", "done")
    const a4 = await orch.spawn({ agent_id: "a4", role: "worker", capabilities: {} })
    expect(a4).toBe("a4")
  })

  test("terminate sets status to dead via terminating", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    await orch.terminate("coder", "test done")
    expect(orch.getInfo("coder")?.status).toBe("dead")
  })

  test("terminate unknown agent is no-op", async () => {
    await orch.terminate("ghost", "never existed")
  })

  test("list returns all agents", async () => {
    await orch.spawn({ agent_id: "a", role: "coder", capabilities: {} })
    await orch.spawn({ agent_id: "b", role: "reviewer", capabilities: {} })
    const list = orch.list()
    expect(list.length).toBe(2)
    expect(list.map((a) => a.id).sort()).toEqual(["a", "b"])
  })

  test("heartbeat updates agent status and tokens", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    orch.registry.recordHeartbeat("coder", {
      status: "busy",
      current_task_id: "t1",
      tokens_used_session: { input: 1000, output: 500 },
    })
    const info = orch.getInfo("coder")
    expect(info?.status).toBe("busy")
    expect(info?.current_task_id).toBe("t1")
    expect(info?.tokens_used.total).toBe(1500)
  })

  test("findIdle returns only idle agents", async () => {
    await orch.spawn({ agent_id: "idle1", role: "worker", capabilities: {} })
    await orch.spawn({ agent_id: "busy1", role: "worker", capabilities: {} })
    orch.registry.updateStatus("busy1", "busy")
    const idle = orch.registry.findIdle()
    expect(idle.length).toBe(1)
    expect(idle[0].id).toBe("idle1")
  })

  test("findByRole returns agents matching role", async () => {
    await orch.spawn({ agent_id: "c1", role: "coder", capabilities: {} })
    await orch.spawn({ agent_id: "c2", role: "coder", capabilities: {} })
    await orch.spawn({ agent_id: "r1", role: "reviewer", capabilities: {} })
    const coders = orch.registry.findByRole("coder")
    expect(coders.length).toBe(2)
  })

  test("findByCapability returns agents with matching tool", async () => {
    await orch.spawn({ agent_id: "editor", role: "coder", capabilities: { tools: ["edit", "bash"] } })
    await orch.spawn({ agent_id: "reader", role: "coder", capabilities: { tools: ["read"] } })
    const editors = orch.registry.findByCapability("edit")
    expect(editors.length).toBe(1)
    expect(editors[0].id).toBe("editor")
  })

  test("agent workspace path is set", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    const info = orch.getInfo("coder")
    expect(info?.workspace_path).toContain("workspace-coder")
  })

  test("spawn generates audit event", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    const audit = await orch.audit.read({ action: "agent.spawn" })
    expect(audit.length).toBe(1)
    expect(audit[0].agent).toBe("coder")
  })

  test("terminate generates audit event", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    await orch.terminate("coder", "done working")
    const audit = await orch.audit.read({ action: "agent.terminate" })
    expect(audit.length).toBe(1)
  })

  test("incrementTokenUsage accumulates", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    orch.registry.incrementTokenUsage("coder", 100, 50)
    orch.registry.incrementTokenUsage("coder", 200, 100)
    const info = orch.getInfo("coder")
    expect(info?.tokens_used.input).toBe(300)
    expect(info?.tokens_used.output).toBe(150)
    expect(info?.tokens_used.total).toBe(450)
  })
})
