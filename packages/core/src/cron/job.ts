export * as Cron from "./job"

import { Schema } from "effect"

export const CronJob = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  prompt: Schema.String,
  intervalMs: Schema.Number,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  createdAt: Schema.Number,
  expiresAt: Schema.Number,
  nextRunAt: Schema.Number,
  lastRunAt: Schema.optional(Schema.Number),
  runCount: Schema.Number,
  context: Schema.optional(Schema.Unknown),
})
export type CronJob = Schema.Schema.Type<typeof CronJob>
