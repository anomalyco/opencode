import { InvalidGoalTransitionError } from "./errors"
import type { Goal, GoalState } from "./types"

const transitions: Record<GoalState, readonly GoalState[]> = {
  CREATED: ["PLANNING", "CANCELLED"],
  PLANNING: ["ACTIVE", "FAILED", "CANCELLED"],
  ACTIVE: ["WAITING", "BLOCKED", "PAUSED", "VERIFYING", "FAILED", "BUDGET_EXCEEDED", "CANCELLED"],
  WAITING: ["ACTIVE", "PAUSED", "BLOCKED", "FAILED", "CANCELLED"],
  BLOCKED: ["ACTIVE", "PAUSED", "FAILED", "CANCELLED"],
  PAUSED: ["ACTIVE", "CANCELLED"],
  VERIFYING: ["ACTIVE", "COMPLETED", "FAILED", "BUDGET_EXCEEDED", "CANCELLED"],
  COMPLETED: [],
  FAILED: ["ACTIVE", "CANCELLED"],
  CANCELLED: [],
  BUDGET_EXCEEDED: ["ACTIVE", "CANCELLED"],
}

export function canTransition(from: GoalState, to: GoalState): boolean {
  return transitions[from].includes(to)
}

export interface TransitionOptions {
  now?: string
}

export function transitionGoal(goal: Goal, to: GoalState, options: TransitionOptions = {}): Goal {
  if (!canTransition(goal.state, to)) {
    throw new InvalidGoalTransitionError({ from: goal.state, to })
  }

  return {
    ...goal,
    state: to,
    updatedAt: options.now ?? new Date().toISOString(),
  }
}
