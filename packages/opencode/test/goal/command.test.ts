import { describe, expect, test } from "bun:test"
import { runGoalCommand } from "@/goal/command"
import type { GoalManager } from "@/goal/manager"
import type { Goal } from "@/goal/types"

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal_123",
    title: "Migrate repository to Bun",
    objective: "Migrate repository to Bun",
    state: "CREATED",
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:00:00.000Z",
    progress: {
      totalSteps: 5,
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
      maxSteps: 10,
    },
    ...overrides,
  }
}

function manager(overrides: Partial<GoalManager> = {}): GoalManager {
  const active = { goal: goal() }
  return {
    init: async () => active,
    create: async (objective) => goal({ objective, title: objective }),
    status: async () => ({ active, output: "GOAL\nState: CREATED" }),
    logs: async () => ({ events: [], output: "GOAL LOGS\nNo goal events." }),
    history: async () => ({ goals: [], output: "GOAL HISTORY\nNo archived goals." }),
    pause: async () => goal({ state: "PAUSED" }),
    resume: async () => goal({ state: "ACTIVE" }),
    enforceBudget: async () => goal({ state: "BUDGET_EXCEEDED" }),
    clear: async () => goal({ state: "CANCELLED" }),
    ...overrides,
  }
}

describe("native goal command handler", () => {
  test("creates a goal when arguments are not a known subcommand", async () => {
    const output = await runGoalCommand(manager(), "Migrate repository to Bun")

    expect(output).toContain("Goal created")
    expect(output).toContain("Migrate repository to Bun")
  })

  test("renders status for empty arguments and status subcommand", async () => {
    expect(await runGoalCommand(manager(), "")).toContain("State: CREATED")
    expect(await runGoalCommand(manager(), "status")).toContain("State: CREATED")
  })

  test("routes pause resume clear and budget subcommands", async () => {
    expect(await runGoalCommand(manager(), "pause")).toContain("Goal paused")
    expect(await runGoalCommand(manager(), "resume")).toContain("Goal resumed")
    expect(await runGoalCommand(manager(), "clear")).toContain("Goal cancelled and archived")
    expect(await runGoalCommand(manager(), "budget")).toContain("Budget")
  })

  test("routes logs subcommand to manager logs", async () => {
    expect(await runGoalCommand(manager({ logs: async () => ({ events: [], output: "GOAL LOGS\nNo goal events." }) }), "logs")).toContain("No goal events")
  })

  test("routes history subcommand to manager history", async () => {
    expect(await runGoalCommand(manager({ history: async () => ({ goals: [], output: "GOAL HISTORY\nNo archived goals." }) }), "history")).toContain("No archived goals")
  })

  test("returns explicit safe output for invalid subcommand forms", async () => {
    expect(await runGoalCommand(manager(), "pause now")).toContain("Unknown /goal subcommand")
  })
})
