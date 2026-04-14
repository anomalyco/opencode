import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import path from "path"
import fs from "fs"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("E2E: crash recovery", () => {
  let dir: string
  let orch: Orchestrator

  beforeEach(async () => {
    dir = await tmpdir()
    orch = new Orchestrator(dir, { heartbeatWarningMs: 500, zombieTimeoutMs: 1500 })
    await orch.start()
  })

  afterEach(async () => {
    orch.stop()
    await cleanup(dir)
  })

  test("agent crash → zombie detection → cleanup → dead-letter", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    orch.taskQueue.enqueue({ task_id: "t1", title: "Work", description: "Do work", priority: "normal" })

    const ag = (orch.registry as any).agents.get("coder")
    ag.last_activity = Date.now() - 5000
    ag.status = "busy"
    ag.current_task_id = "t1"

    const { zombies } = await orch.watchdog.tick()
    expect(zombies.length).toBe(1)
    expect(zombies[0]).toBe("coder")

    const info = (orch.registry as any).agents.get("coder")
    expect(info.status).toBe("dead")
    expect(orch.taskQueue.getTaskStatus("t1")?.status).toBe("cancelled")

    const audit = await orch.audit.read({ action: "agent.crash" })
    expect(audit.length).toBe(1)
  })

  test("orchestrator crash → restart → state recovered", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    orch.registry.updateStatus("coder", "busy")
    await orch.state.saveSnapshot({ agents: orch.registry.toSnapshot() })

    const orch2 = new Orchestrator(dir, { heartbeatWarningMs: 500, zombieTimeoutMs: 1500 })
    await orch2.start()
    const coder = orch2.getInfo("coder")
    expect(coder).toBeTruthy()
    expect(coder?.role).toBe("coder")
    expect(coder?.status).toBe("busy")
    orch2.stop()
  })

  test("agent does not re-register → stays as last known state", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    await orch.state.saveSnapshot({ agents: orch.registry.toSnapshot() })

    const orch2 = new Orchestrator(dir)
    await orch2.start()
    expect(orch2.getInfo("coder")).toBeTruthy()
    orch2.stop()
  })

  test("audit trail persists across restart", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    await orch.audit.append({ agent: "coder", action: "task.assigned", target: "t1" })

    const orch2 = new Orchestrator(dir)
    await orch2.start()
    const audit = await orch2.audit.read({ agent: "coder" })
    expect(audit.length).toBeGreaterThanOrEqual(1)
    expect(audit.some((e) => e.action === "task.assigned")).toBe(true)
    orch2.stop()
  })
})
