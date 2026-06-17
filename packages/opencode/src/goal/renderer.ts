import type { ActiveGoalState } from "./store"
import type { Goal } from "./types"

function formatLimit(used: number, max?: number): string {
  return max === undefined ? String(used) : `${used} / ${max}`
}

export function renderNoActiveGoal(): string {
  return "No active goal.\nCreate one with /goal <objective>"
}

export function renderGoalStatus(active: ActiveGoalState): string {
  const { goal, plan } = active
  const currentStep = plan?.steps.find((step) => step.id === goal.currentStepId)
  const lines = [
    "GOAL",
    "─────────────────────",
    `Title: ${goal.title}`,
    `State: ${goal.state}`,
    `Progress: ${goal.progress.completedSteps} / ${goal.progress.totalSteps} steps complete`,
    `Current Step: ${currentStep?.title ?? goal.currentStepId ?? "None"}`,
    "",
    "Budget:",
    `  Steps: ${formatLimit(goal.budget.usedSteps, goal.budget.maxSteps)}`,
    `  Runtime: ${formatLimit(goal.budget.usedRuntimeMs, goal.budget.maxRuntimeMs)}`,
    `  Tokens: ${formatLimit(goal.budget.usedTokens, goal.budget.maxTokens)}`,
    `  Cost: ${formatLimit(goal.budget.usedCostUsd, goal.budget.maxCostUsd)}`,
  ]

  return lines.join("\n")
}

export function renderGoalPaused(goal: Goal): string {
  return `Goal paused: ${goal.id}`
}

export function renderGoalResumed(goal: Goal): string {
  return `Goal resumed: ${goal.id}`
}

export function renderGoalCleared(goal: Goal): string {
  return `Goal cancelled and archived: ${goal.id}`
}
