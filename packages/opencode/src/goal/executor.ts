import type { Goal, GoalPlan, GoalState, GoalStep } from "./types"

const stoppedStates = new Set<GoalState>(["PAUSED", "BLOCKED", "FAILED", "CANCELLED", "COMPLETED", "BUDGET_EXCEEDED"])

export type GoalExecutionStopReason = "STOPPED_STATE" | "NO_ACTIONABLE_STEP" | "MAX_ITERATIONS" | "STEP_READY"

export interface GoalExecutionLoopInput {
  goal: Goal
  plan: GoalPlan
  maxIterations: number
}

export interface GoalExecutionLoopResult {
  iterations: number
  reason: GoalExecutionStopReason
  selectedStep?: string
}

export function shouldStopGoalExecution(goal: Goal): boolean {
  return stoppedStates.has(goal.state)
}

function completedStepIds(plan: GoalPlan): Set<string> {
  return new Set(plan.steps.filter((step) => step.status === "COMPLETED").map((step) => step.id))
}

function dependenciesComplete(step: GoalStep, completed: Set<string>): boolean {
  return step.dependencies.every((dependency) => completed.has(dependency))
}

export function selectNextGoalStep(plan: GoalPlan): GoalStep | undefined {
  const completed = completedStepIds(plan)
  return plan.steps.find((step) => step.status === "PENDING" && dependenciesComplete(step, completed))
}

export async function runGoalExecutionLoop(input: GoalExecutionLoopInput): Promise<GoalExecutionLoopResult> {
  if (input.maxIterations <= 0) return { iterations: 0, reason: "MAX_ITERATIONS" }
  if (shouldStopGoalExecution(input.goal)) return { iterations: 0, reason: "STOPPED_STATE" }

  const next = selectNextGoalStep(input.plan)
  if (!next) return { iterations: 0, reason: "NO_ACTIONABLE_STEP" }

  return { iterations: 1, reason: "STEP_READY", selectedStep: next.id }
}
