export * as SessionStats from "./session-stats.js"

import { Schema } from "effect"
import { Model } from "./model.js"
import { Money } from "./money.js"
import { DateTimeUtcFromMillis, NonNegativeInt, optional } from "./schema.js"
import { TokenUsage } from "./token-usage.js"

export const Activity = Schema.Struct({
  date: Schema.String,
  steps: NonNegativeInt,
}).annotate({ identifier: "SessionStats.Activity" })
export type Activity = typeof Activity.Type

export const ModelUsage = Schema.Struct({
  model: Model.Ref,
  steps: NonNegativeInt,
  tokens: TokenUsage.Info,
  cost: Money.USD,
}).annotate({ identifier: "SessionStats.ModelUsage" })
export type ModelUsage = typeof ModelUsage.Type

export const ToolUsage = Schema.Struct({
  name: Schema.String,
  calls: NonNegativeInt,
  succeeded: NonNegativeInt,
  failed: NonNegativeInt,
  unfinished: NonNegativeInt,
  durationP50: Schema.Finite.pipe(optional),
}).annotate({ identifier: "SessionStats.ToolUsage" })
export type ToolUsage = typeof ToolUsage.Type

export const ToolMode = Schema.Literals(["none", "summary", "detail"])
export type ToolMode = typeof ToolMode.Type

export const ToolTotals = Schema.Struct({
  calls: NonNegativeInt,
  succeeded: NonNegativeInt,
  failed: NonNegativeInt,
  unfinished: NonNegativeInt,
}).annotate({ identifier: "SessionStats.ToolTotals" })
export type ToolTotals = typeof ToolTotals.Type

export const Tools = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("none") }),
  Schema.Struct({ mode: Schema.Literal("summary"), totals: ToolTotals }),
  Schema.Struct({ mode: Schema.Literal("detail"), totals: ToolTotals, usage: Schema.Array(ToolUsage) }),
]).annotate({ identifier: "SessionStats.Tools" })
export type Tools = typeof Tools.Type

export const Info = Schema.Struct({
  range: Schema.Struct({
    from: DateTimeUtcFromMillis,
    to: DateTimeUtcFromMillis,
  }),
  sessions: NonNegativeInt,
  subagents: NonNegativeInt,
  prompts: NonNegativeInt,
  steps: NonNegativeInt,
  tokens: TokenUsage.Info,
  cost: Money.USD,
  tools: Tools,
  activeDays: NonNegativeInt,
  streak: NonNegativeInt,
  activity: Schema.Array(Activity),
  models: Schema.Array(ModelUsage),
}).annotate({ identifier: "SessionStats.Info" })
export type Info = typeof Info.Type
