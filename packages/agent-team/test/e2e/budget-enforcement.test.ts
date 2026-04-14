import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { Orchestrator } from "../../src/orchestrator/index.js"
import { tmpdir, cleanup } from "../fixture/workspace.js"

describe("E2E: budget enforcement", () => {
  let dir: string
  let orch: Orchestrator

  beforeEach(async () => {
    dir = await tmpdir()
    orch = new Orchestrator(dir, {
      perTaskMaxUsd: 1,
      perAgentDailyUsd: 2,
      dailyLimitUsd: 5,
      maxConcurrent: 5,
    })
    await orch.start()
    await orch.spawn({ agent_id: "coder", role: "coder", capabilities: {} })
  })

  afterEach(async () => {
    orch.stop()
    await cleanup(dir)
  })

  test("task rejected when per_task_max exceeded", () => {
    const result = orch.taskQueue.enqueue({
      task_id: "t1",
      title: "Expensive task",
      description: "Over budget",
      priority: "normal",
      budget: { max_cost: 5 },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("budget")
  })

  test("new task rejected when per_agent_daily exceeded", () => {
    orch.budget.trackUsage("coder", 0, 2.5)
    const result = orch.taskQueue.enqueue({
      task_id: "t2",
      title: "Another task",
      description: "Over agent budget",
      priority: "normal",
      budget: { max_cost: 1 },
    })
    expect(result.ok).toBe(false)
  })

  test("new task rejected when team daily_limit exceeded", async () => {
    await orch.spawn({ agent_id: "coder2", role: "coder", capabilities: {} })
    orch.budget.trackUsage("coder", 0, 3)
    orch.budget.trackUsage("coder2", 0, 3)
    const result = orch.taskQueue.enqueue({
      task_id: "t3",
      title: "Over team budget",
      description: "Nope",
      priority: "normal",
      budget: { max_cost: 1 },
    })
    expect(result.ok).toBe(false)
  })

  test("daily reset → budget available again", () => {
    orch.budget.trackUsage("coder", 0, 2.5)
    expect(orch.budget.checkBudget("coder", 0.5)).toBe(false)
    orch.budget.resetDaily()
    expect(orch.budget.checkBudget("coder", 0.5)).toBe(true)
  })

  test("budget tracked correctly during task lifecycle", () => {
    orch.taskQueue.enqueue({ task_id: "t1", title: "A", description: "a", priority: "normal" })
    orch.taskQueue.complete("t1", {
      task_id: "t1",
      status: "completed",
      summary: "done",
      tokens_used: { input: 1000, output: 500 },
      cost: 0.25,
    })
    const usage = orch.budget.getUsage("coder")
    expect(usage.cost).toBeCloseTo(0.25)
    const teamUsage = orch.budget.getTeamUsage()
    expect(teamUsage.cost).toBeCloseTo(0.25)
  })
})
