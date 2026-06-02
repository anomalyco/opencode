import { Schema } from "effect"

export const SelfImprovement = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "SelfImprovementConfig" })

export * as ConfigSelfImprovement from "./self-improvement"