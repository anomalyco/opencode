import { describe, test, expect } from "bun:test"
import { BudgetManager } from "../../src/orchestrator/budget.js"

describe("BudgetManager", () => {
  test("trackUsage accumulates usage", () => {
    const bm = new BudgetManager()
    bm.trackUsage("a1", 100, 0.5)
    bm.trackUsage("a1", 200, 1.0)
    const usage = bm.getUsage("a1")
    expect(usage.total).toBe(300)
    expect(usage.cost).toBe(1.5)
  })

  test("getTeamUsage returns sum of all agents", () => {
    const bm = new BudgetManager()
    bm.trackUsage("a1", 100, 0.5)
    bm.trackUsage("a2", 200, 1.0)
    const team = bm.getTeamUsage()
    expect(team.total).toBe(300)
    expect(team.cost).toBe(1.5)
  })

  test("checkBudget returns true when within budget", () => {
    const bm = new BudgetManager({ per_agent_daily_usd: 10, daily_limit_usd: 50 })
    expect(bm.checkBudget("a1", 1)).toBe(true)
  })

  test("checkBudget rejects when per_agent_daily exceeded", () => {
    const bm = new BudgetManager({ per_agent_daily_usd: 1 })
    bm.trackUsage("a1", 0, 0.8)
    expect(bm.checkBudget("a1", 0.5)).toBe(false)
  })

  test("checkBudget rejects when daily_limit exceeded", () => {
    const bm = new BudgetManager({ daily_limit_usd: 1 })
    bm.trackUsage("a1", 0, 0.8)
    expect(bm.checkBudget("team", 0.5)).toBe(false)
  })

  test("checkBudget rejects when per_task_max exceeded", () => {
    const bm = new BudgetManager({ per_task_max_usd: 0.5 })
    expect(bm.checkBudget("a1", 1.0)).toBe(false)
  })

  test("resetDaily clears counters", () => {
    const bm = new BudgetManager()
    bm.trackUsage("a1", 100, 1.0)
    bm.resetDaily()
    expect(bm.getUsage("a1").total).toBe(0)
    expect(bm.getTeamUsage().total).toBe(0)
  })

  test("getBudget returns config + remaining", () => {
    const bm = new BudgetManager({ daily_limit_usd: 50 })
    bm.trackUsage("a1", 0, 10)
    const budget = bm.getBudget()
    expect(budget.team_remaining_usd).toBe(40)
  })
})
