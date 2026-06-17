import { Schema } from "effect"

export class InvalidGoalTransitionError extends Schema.TaggedErrorClass<InvalidGoalTransitionError>()(
  "GoalInvalidTransitionError",
  {
    from: Schema.String,
    to: Schema.String,
  },
) {}

export class ActiveGoalExistsError extends Schema.TaggedErrorClass<ActiveGoalExistsError>()("GoalActiveGoalExistsError", {
  goalId: Schema.String,
}) {}

export class NoActiveGoalError extends Schema.TaggedErrorClass<NoActiveGoalError>()("GoalNoActiveGoalError", {
  operation: Schema.String,
}) {}

export class MalformedGoalStateError extends Schema.TaggedErrorClass<MalformedGoalStateError>()("GoalMalformedStateError", {
  path: Schema.String,
  reason: Schema.String,
}) {}

export class GoalBudgetExceededError extends Schema.TaggedErrorClass<GoalBudgetExceededError>()("GoalBudgetExceededError", {
  metric: Schema.String,
  used: Schema.Number,
  max: Schema.Number,
}) {}

export class GoalVerificationFailedError extends Schema.TaggedErrorClass<GoalVerificationFailedError>()(
  "GoalVerificationFailedError",
  {
    goalId: Schema.String,
    stepId: Schema.optional(Schema.String),
    evidenceId: Schema.optional(Schema.String),
  },
) {}

export type Error =
  | InvalidGoalTransitionError
  | ActiveGoalExistsError
  | NoActiveGoalError
  | MalformedGoalStateError
  | GoalBudgetExceededError
  | GoalVerificationFailedError
