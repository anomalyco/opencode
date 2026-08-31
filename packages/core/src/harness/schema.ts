import { Schema } from "effect"

export const FlexibleNumber = Schema.Union([Schema.Number, Schema.NumberFromString])
export type FlexibleNumber = typeof FlexibleNumber.Type

export {
  vecCol,
  harness_task,
  harness_subtask_feedback,
  harness_version,
  harness_regression_result,
} from "./sql"
