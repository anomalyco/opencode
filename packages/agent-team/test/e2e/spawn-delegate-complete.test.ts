import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import path from "path"
import fs from "fs"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { generateIdempotencyKey } from "../../src/protocol/schema.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("E2E: spawn-delegate-complete flow", () => {
  let dir: string
  let orch: Orchestrator

  beforeEach(async () => {
    dir = await tmpdir()
    orch = new Orchestrator(dir)
    await orch.start()
  })

  afterEach(async () => {
    orch.stop()
    await cleanup(dir)
  })

  test("full spawn → delegate → progress → complete flow", async () => {
    const coderId = await orch.spawn({
      agent_id: "coder",
      role: "coder",
      capabilities: { tools: ["read", "edit", "bash"] },
    })
    expect(coderId).toBe("coder")
    const coder = orch.getInfo("coder")
    expect(coder?.status).toBe("idle")
    expect(coder?.role).toBe("coder")

    const taskId = "task-1"
    const enqueueResult = orch.taskQueue.enqueue({
      task_id: taskId,
      title: "Implement auth module",
      description: "Create JWT auth middleware",
      priority: "high",
      required_capabilities: ["edit"],
    })
    expect(enqueueResult.ok).toBe(true)
    const taskState = orch.taskQueue.getTaskStatus(taskId)
    expect(taskState?.status).toBe("assigned")
    expect(taskState?.assigned_to).toBe("coder")
    expect(orch.getInfo("coder")?.status).toBe("busy")
    expect(orch.getInfo("coder")?.current_task_id).toBe(taskId)

    orch.registry.recordHeartbeat("coder", {
      status: "busy",
      current_task_id: taskId,
      tokens_used_session: { input: 500, output: 200 },
    })
    expect(orch.getInfo("coder")?.tokens_used.total).toBe(700)

    orch.taskQueue.complete(taskId, {
      task_id: taskId,
      status: "completed",
      summary: "Auth module implemented",
      files_modified: ["src/auth.ts"],
      files_created: ["src/middleware/jwt.ts"],
      branch: "team/coder/auth",
      tokens_used: { input: 2000, output: 800 },
      cost: 0.15,
    })
    expect(orch.taskQueue.getTaskStatus(taskId)?.status).toBe("completed")
    expect(orch.getInfo("coder")?.status).toBe("idle")

    const usage = orch.budget.getUsage("coder")
    expect(usage.total).toBe(2800)
    expect(usage.cost).toBeCloseTo(0.15)

    const audit = await orch.audit.read({ agent: "coder" })
    expect(audit.length).toBeGreaterThanOrEqual(1)
    expect(audit.some((e) => e.action === "agent.spawn")).toBe(true)
  })

  test("cost tracked across multiple tasks", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    orch.taskQueue.enqueue({ task_id: "t1", title: "A", description: "a", priority: "normal" })
    orch.taskQueue.complete("t1", {
      task_id: "t1",
      status: "completed",
      summary: "done",
      tokens_used: { input: 1000, output: 500 },
      cost: 0.1,
    })
    orch.taskQueue.enqueue({ task_id: "t2", title: "B", description: "b", priority: "normal" })
    orch.taskQueue.complete("t2", {
      task_id: "t2",
      status: "completed",
      summary: "done",
      tokens_used: { input: 800, output: 300 },
      cost: 0.05,
    })
    const usage = orch.budget.getUsage("coder")
    expect(usage.cost).toBeCloseTo(0.15)
  })

  test("human inbox receives notifications", async () => {
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
    await orch.spawn({ agent_id: "human", role: "human", capabilities: {} })

    const env = {
      id: crypto.randomUUID(),
      type: "message" as const,
      from: "coder",
      to: "human",
      timestamp: Date.now(),
      hop_count: 0,
      idempotency_key: generateIdempotencyKey("task done", "coder", "message"),
      priority: "normal" as const,
      protocol_version: 1,
      payload: { content: "Task completed, please review" },
    }
    const result = orch.router.route(env)
    expect(result.ok).toBe(true)
    expect(orch.router.getInboxSize("human")).toBe(1)
  })
})
