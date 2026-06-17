import { GoalBudgetExceededError } from "./errors"
import type { Goal, GoalBudget } from "./types"

export interface BudgetUsageDelta {
  steps?: number
  runtimeMs?: number
  tokens?: number
  costUsd?: number
}

function add(value: number, delta = 0): number {
  return value + delta
}

export function applyBudgetUsage(goal: Goal, delta: BudgetUsageDelta): Goal {
  return {
    ...goal,
    budget: {
      ...goal.budget,
      usedSteps: add(goal.budget.usedSteps, delta.steps),
      usedRuntimeMs: add(goal.budget.usedRuntimeMs, delta.runtimeMs),
      usedTokens: add(goal.budget.usedTokens, delta.tokens),
      usedCostUsd: add(goal.budget.usedCostUsd, delta.costUsd),
    },
  }
}

export function checkGoalBudget(goal: Goal): GoalBudgetExceededError | null {
  if (goal.budget.maxSteps !== undefined && goal.budget.usedSteps > goal.budget.maxSteps) {
    return new GoalBudgetExceededError({ metric: "steps", used: goal.budget.usedSteps, max: goal.budget.maxSteps })
  }
  if (goal.budget.maxRuntimeMs !== undefined && goal.budget.usedRuntimeMs > goal.budget.maxRuntimeMs) {
    return new GoalBudgetExceededError({ metric: "runtime", used: goal.budget.usedRuntimeMs, max: goal.budget.maxRuntimeMs })
  }
  if (goal.budget.maxTokens !== undefined && goal.budget.usedTokens > goal.budget.maxTokens) {
    return new GoalBudgetExceededError({ metric: "tokens", used: goal.budget.usedTokens, max: goal.budget.maxTokens })
  }
  if (goal.budget.maxCostUsd !== undefined && goal.budget.usedCostUsd > goal.budget.maxCostUsd) {
    return new GoalBudgetExceededError({ metric: "cost", used: goal.budget.usedCostUsd, max: goal.budget.maxCostUsd })
  }
  return null
}

export function isBudgetExceeded(goal: Goal): boolean {
  return checkGoalBudget(goal) !== null
}

function formatLimit(used: number, max?: number): string {
  return max === undefined ? String(used) : `${used} / ${max}`
}

export function renderBudgetSummary(budget: GoalBudget): string {
  return [
    "Budget",
    `Steps: ${formatLimit(budget.usedSteps, budget.maxSteps)}`,
    `Runtime: ${formatLimit(budget.usedRuntimeMs, budget.maxRuntimeMs)}`,
    `Tokens: ${formatLimit(budget.usedTokens, budget.maxTokens)}`,
    `Cost: ${formatLimit(budget.usedCostUsd, budget.maxCostUsd)}`,
  ].join("\n")
}
