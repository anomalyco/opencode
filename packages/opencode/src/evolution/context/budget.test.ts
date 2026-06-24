import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { ContextBudget } from "./budget"

describe("ContextBudget.Service", () => {
  const config = { contextBudget: 1000 }

  test("budget() returns configured value without modification", () => {
    const svc = ContextBudget.make(config)
    expect(svc.budget()).toBe(1000)
  })

  test("budget() defaults to 4096 when not configured", () => {
    const svc = ContextBudget.make({})
    expect(svc.budget()).toBe(4096)
  })

  test("total() sums domain usage correctly", () => {
    const svc = ContextBudget.make(config)
    expect(svc.total({ memory: 300, decisions: 200, project: 100 })).toBe(600)
  })

  test("enforce() succeeds when total equals budget", () => {
    const svc = ContextBudget.make({ contextBudget: 600 })
    const exit = Effect.runSyncExit(svc.enforce({ memory: 200, decisions: 200, project: 200 }))
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("enforce() fails with ContextBudgetError when total exceeds budget", () => {
    const svc = ContextBudget.make({ contextBudget: 500 })
    const exit = Effect.runSyncExit(svc.enforce({ memory: 300, decisions: 200, project: 100 }))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const err = Cause.squash(exit.cause) as ContextBudget.ContextBudgetError
      expect(err._tag).toBe("EvolutionContextBudgetError")
      expect(err.message).toContain("600 tokens used")
      expect(err.message).toContain("500 configured")
    }
  })

  test("enforce() error message includes breakdown", () => {
    const svc = ContextBudget.make({ contextBudget: 100 })
    const exit = Effect.runSyncExit(svc.enforce({ memory: 50, decisions: 40, project: 30 }))
    if (Exit.isFailure(exit)) {
      const err = Cause.squash(exit.cause) as ContextBudget.ContextBudgetError
      expect(err.message).toContain("memory: 50")
      expect(err.message).toContain("decisions: 40")
      expect(err.message).toContain("project: 30")
    }
  })

  test("total() returns 0 for empty usage", () => {
    const svc = ContextBudget.make(config)
    expect(svc.total({ memory: 0, decisions: 0, project: 0 })).toBe(0)
  })
})
