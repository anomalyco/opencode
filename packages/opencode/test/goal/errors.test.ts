import { describe, expect, test } from "bun:test"
import {
  ActiveGoalExistsError,
  GoalBudgetExceededError,
  GoalVerificationFailedError,
  InvalidGoalTransitionError,
  MalformedGoalStateError,
  NoActiveGoalError,
} from "@/goal/errors"

describe("goal errors", () => {
  test("creates invalid transition errors with state context", () => {
    const error = new InvalidGoalTransitionError({ from: "COMPLETED", to: "ACTIVE" })

    expect(error._tag).toBe("GoalInvalidTransitionError")
    expect(error.from).toBe("COMPLETED")
    expect(error.to).toBe("ACTIVE")
  })

  test("creates active goal conflict errors with goal context", () => {
    const error = new ActiveGoalExistsError({ goalId: "goal_active" })

    expect(error._tag).toBe("GoalActiveGoalExistsError")
    expect(error.goalId).toBe("goal_active")
  })

  test("creates no active goal errors", () => {
    const error = new NoActiveGoalError({ operation: "pause" })

    expect(error._tag).toBe("GoalNoActiveGoalError")
    expect(error.operation).toBe("pause")
  })

  test("creates malformed state errors with safe path context", () => {
    const error = new MalformedGoalStateError({ path: ".opencode/goals/active/goal.json", reason: "invalid json" })

    expect(error._tag).toBe("GoalMalformedStateError")
    expect(error.path).toBe(".opencode/goals/active/goal.json")
    expect(error.reason).toBe("invalid json")
  })

  test("creates budget exceeded errors with metric context", () => {
    const error = new GoalBudgetExceededError({ metric: "steps", used: 51, max: 50 })

    expect(error._tag).toBe("GoalBudgetExceededError")
    expect(error.metric).toBe("steps")
    expect(error.used).toBe(51)
    expect(error.max).toBe(50)
  })

  test("creates verification failure errors with evidence context", () => {
    const error = new GoalVerificationFailedError({ goalId: "goal_123", stepId: "step_1", evidenceId: "evidence_123" })

    expect(error._tag).toBe("GoalVerificationFailedError")
    expect(error.goalId).toBe("goal_123")
    expect(error.stepId).toBe("step_1")
    expect(error.evidenceId).toBe("evidence_123")
  })
})
