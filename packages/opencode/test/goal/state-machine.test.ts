import { describe, expect, test } from "bun:test"
import { InvalidGoalTransitionError } from "@/goal/errors"
import { canTransition, transitionGoal } from "@/goal/state-machine"
import type { Goal } from "@/goal/types"

function goal(state: Goal["state"]): Goal {
  return {
    id: "goal_123",
    title: "Migrate repository to Bun",
    objective: "Migrate the repository to Bun and verify package checks pass.",
    state,
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:00.000Z",
    progress: {
      totalSteps: 0,
      completedSteps: 0,
      failedSteps: 0,
      blockedSteps: 0,
      percentComplete: 0,
    },
    budget: {
      usedTokens: 0,
      usedRuntimeMs: 0,
      usedSteps: 0,
      usedCostUsd: 0,
    },
  }
}

describe("goal state machine", () => {
  test("allows the normal create plan execute verify complete flow", () => {
    expect(canTransition("CREATED", "PLANNING")).toBe(true)
    expect(canTransition("PLANNING", "ACTIVE")).toBe(true)
    expect(canTransition("ACTIVE", "VERIFYING")).toBe(true)
    expect(canTransition("VERIFYING", "COMPLETED")).toBe(true)
  })

  test("allows pausing and resuming active work", () => {
    expect(canTransition("ACTIVE", "PAUSED")).toBe(true)
    expect(canTransition("WAITING", "PAUSED")).toBe(true)
    expect(canTransition("BLOCKED", "PAUSED")).toBe(true)
    expect(canTransition("PAUSED", "ACTIVE")).toBe(true)
  })

  test("allows recoverable failure and budget states to resume to active", () => {
    expect(canTransition("ACTIVE", "FAILED")).toBe(true)
    expect(canTransition("VERIFYING", "FAILED")).toBe(true)
    expect(canTransition("FAILED", "ACTIVE")).toBe(true)
    expect(canTransition("ACTIVE", "BUDGET_EXCEEDED")).toBe(true)
    expect(canTransition("VERIFYING", "BUDGET_EXCEEDED")).toBe(true)
    expect(canTransition("BUDGET_EXCEEDED", "ACTIVE")).toBe(true)
  })

  test("allows cancelling non-terminal states", () => {
    expect(canTransition("CREATED", "CANCELLED")).toBe(true)
    expect(canTransition("PLANNING", "CANCELLED")).toBe(true)
    expect(canTransition("ACTIVE", "CANCELLED")).toBe(true)
    expect(canTransition("PAUSED", "CANCELLED")).toBe(true)
    expect(canTransition("FAILED", "CANCELLED")).toBe(true)
  })

  test("rejects invalid transitions", () => {
    expect(canTransition("CREATED", "COMPLETED")).toBe(false)
    expect(() => transitionGoal(goal("CREATED"), "COMPLETED")).toThrow(InvalidGoalTransitionError)
  })

  test("protects completed and cancelled terminal states", () => {
    expect(canTransition("COMPLETED", "ACTIVE")).toBe(false)
    expect(canTransition("CANCELLED", "ACTIVE")).toBe(false)
    expect(() => transitionGoal(goal("COMPLETED"), "ACTIVE")).toThrow(InvalidGoalTransitionError)
    expect(() => transitionGoal(goal("CANCELLED"), "ACTIVE")).toThrow(InvalidGoalTransitionError)
  })

  test("transitions immutably and updates timestamp", () => {
    const original = goal("CREATED")
    const transitioned = transitionGoal(original, "PLANNING", { now: "2026-06-17T00:00:01.000Z" })

    expect(original.state).toBe("CREATED")
    expect(original.updatedAt).toBe("2026-06-17T00:00:00.000Z")
    expect(transitioned.state).toBe("PLANNING")
    expect(transitioned.updatedAt).toBe("2026-06-17T00:00:01.000Z")
  })
})
