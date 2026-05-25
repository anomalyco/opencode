export * as ConfigPsychosisDetector from "./psychosis-detector"

import { Schema } from "effect"
import { PositiveInt } from "@opencode-ai/core/schema"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description:
      "Warn when too many opencode instances are running for too long",
  }),
  max_instances: Schema.optional(PositiveInt).annotate({
    description:
      "Number of running instances before warnings begin (default: 3)",
  }),
  max_hours: Schema.optional(PositiveInt).annotate({
    description:
      "Hours of continuous runtime before warnings begin (default: 12)",
  }),
}).annotate({ identifier: "PsychosisDetectorConfig" })
export type Info = Schema.Schema.Type<typeof Info>
