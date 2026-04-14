import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("E2E: multi-agent tasks", () => {
  let dir: string
  let orch: Orchestrator

  beforeEach(async () => {
    dir = await tmpdir()
    orch = new Orchestrator(dir, { maxConcurrent: 4 })
    await orch.start()
  })

  afterEach(async () => {
    orch.stop()
    await cleanup(dir)
  })

  test("task assigned to idle agent with matching capabilities", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: { tools: ["read", "edit", "bash"] } })
    const result = orch.taskQueue.enqueue({
      task_id: "t1",
      title: "Fix bug",
      description: "Fix auth bug",
      priority: "normal",
      required_capabilities: ["edit", "bash"],
    })
    expect(result.ok).toBe(true)
    const task = orch.taskQueue.getTaskStatus("t1")
    expect(task?.status).toBe("assigned")
    expect(task?.assigned_to).toBe("coder")
  })

  test("task stays pending if no agent has required capabilities", async () => {
    await orch.spawn({ agent_id: "reader", role: "reader", capabilities: { tools: ["read"] } })
    const result = orch.taskQueue.enqueue({
      task_id: "t1",
      title: "Deploy",
      description: "Deploy to prod",
      priority: "normal",
      required_capabilities: ["bash"],
    })
    expect(result.ok).toBe(true)
    const task = orch.taskQueue.getTaskStatus("t1")
    expect(task?.status).toBe("pending")
    expect(task?.assigned_to).toBeUndefined()
  })

  test("high priority task assigned before low priority", async () => {
    await orch.spawn({ agent_id: "w1", role: "worker", capabilities: {} })
    await orch.spawn({ agent_id: "w2", role: "worker", capabilities: {} })
    orch.taskQueue.enqueue({ task_id: "block1", title: "Block 1", description: "b1", priority: "normal" })
    orch.taskQueue.enqueue({ task_id: "block2", title: "Block 2", description: "b2", priority: "normal" })
    expect(orch.getInfo("w1")?.status).toBe("busy")
    expect(orch.getInfo("w2")?.status).toBe("busy")
    orch.taskQueue.enqueue({
      task_id: "low1",
      title: "Low task",
      description: "Low priority",
      priority: "low",
    })
    orch.taskQueue.enqueue({
      task_id: "high1",
      title: "Urgent",
      description: "Critical fix",
      priority: "critical",
    })
    expect(orch.taskQueue.getTaskStatus("low1")?.status).toBe("pending")
    expect(orch.taskQueue.getTaskStatus("high1")?.status).toBe("pending")
    orch.taskQueue.complete("block1", {
      task_id: "block1",
      status: "completed",
      summary: "done",
      tokens_used: { input: 100, output: 50 },
    })
    expect(orch.taskQueue.getTaskStatus("high1")?.status).toBe("assigned")
    expect(orch.taskQueue.getTaskStatus("high1")?.assigned_to).toBe("w1")
    expect(orch.taskQueue.getTaskStatus("low1")?.status).toBe("pending")
  })

  test("max concurrent tasks enforced", async () => {
    const limitedOrch = new Orchestrator(dir, { maxConcurrent: 2 })
    await limitedOrch.start()
    await limitedOrch.spawn({ agent_id: "a", role: "worker", capabilities: {} })
    await limitedOrch.spawn({ agent_id: "b", role: "worker", capabilities: {} })
    await limitedOrch.spawn({ agent_id: "c", role: "worker", capabilities: {} })
    const r1 = limitedOrch.taskQueue.enqueue({ task_id: "t1", title: "A", description: "a", priority: "normal" })
    const r2 = limitedOrch.taskQueue.enqueue({ task_id: "t2", title: "B", description: "b", priority: "normal" })
    const r3 = limitedOrch.taskQueue.enqueue({ task_id: "t3", title: "C", description: "c", priority: "normal" })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(r3.ok).toBe(false)
    expect((r3 as { ok: false; error: string }).error).toContain("concurrent")
    limitedOrch.stop()
  })

  test("task cancelled and agent freed", async () => {
    await orch.spawn({ agent_id: "worker", role: "worker", capabilities: {} })
    orch.taskQueue.enqueue({ task_id: "t1", title: "Work", description: "do it", priority: "normal" })
    expect(orch.taskQueue.getTaskStatus("t1")?.status).toBe("assigned")
    expect(orch.getInfo("worker")?.status).toBe("busy")
    orch.taskQueue.cancel("t1")
    expect(orch.taskQueue.getTaskStatus("t1")?.status).toBe("cancelled")
    expect(orch.getInfo("worker")?.status).toBe("idle")
  })

  test("completed task frees agent for next pending task", async () => {
    await orch.spawn({ agent_id: "worker", role: "worker", capabilities: {} })
    orch.taskQueue.enqueue({ task_id: "t1", title: "First", description: "a", priority: "normal" })
    orch.taskQueue.enqueue({ task_id: "t2", title: "Second", description: "b", priority: "normal" })
    expect(orch.taskQueue.getTaskStatus("t1")?.status).toBe("assigned")
    expect(orch.taskQueue.getTaskStatus("t2")?.status).toBe("pending")
    orch.taskQueue.complete("t1", {
      task_id: "t1",
      status: "completed",
      summary: "done",
      tokens_used: { input: 500, output: 200 },
      cost: 0.1,
    })
    expect(orch.taskQueue.getTaskStatus("t2")?.status).toBe("assigned")
    expect(orch.taskQueue.getTaskStatus("t2")?.assigned_to).toBe("worker")
  })

  test("delegation depth enforced", () => {
    orch.taskQueue.enqueue({ task_id: "t0", title: "Root", description: "r", priority: "normal" })
    orch.taskQueue.enqueue({ task_id: "t1", title: "D1", description: "1", priority: "normal", parent_task_id: "t0" })
    orch.taskQueue.enqueue({ task_id: "t2", title: "D2", description: "2", priority: "normal", parent_task_id: "t1" })
    orch.taskQueue.enqueue({ task_id: "t3", title: "D3", description: "3", priority: "normal", parent_task_id: "t2" })
    const result = orch.taskQueue.enqueue({
      task_id: "t4",
      title: "D4",
      description: "4",
      priority: "normal",
      parent_task_id: "t3",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("delegation depth")
  })

  test("list pending and active tasks", async () => {
    await orch.spawn({ agent_id: "a", role: "worker", capabilities: {} })
    await orch.spawn({ agent_id: "b", role: "worker", capabilities: {} })
    orch.taskQueue.enqueue({ task_id: "t1", title: "A", description: "a", priority: "normal" })
    orch.taskQueue.enqueue({ task_id: "t2", title: "B", description: "b", priority: "normal" })
    expect(orch.taskQueue.listActive().length).toBe(2)
    expect(orch.taskQueue.listPending().length).toBe(0)
  })

  test("multiple agents pick up tasks in parallel", async () => {
    await orch.spawn({ agent_id: "a", role: "worker", capabilities: {} })
    await orch.spawn({ agent_id: "b", role: "worker", capabilities: {} })
    orch.taskQueue.enqueue({ task_id: "t1", title: "A", description: "a", priority: "normal" })
    orch.taskQueue.enqueue({ task_id: "t2", title: "B", description: "b", priority: "normal" })
    const t1 = orch.taskQueue.getTaskStatus("t1")
    const t2 = orch.taskQueue.getTaskStatus("t2")
    expect(t1?.assigned_to).toBeDefined()
    expect(t2?.assigned_to).toBeDefined()
    expect(t1?.assigned_to).not.toBe(t2?.assigned_to)
  })
})
