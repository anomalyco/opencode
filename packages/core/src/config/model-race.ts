export * as ConfigModelRace from "./model-race"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable model racing for LLM generations (default: false)",
  }),
  models: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Candidate models in provider/model format",
  }),
  strategy: Schema.optional(
    Schema.Struct({
      firstToken: Schema.optional(Schema.Boolean).annotate({
        description: "Use the first valid token to choose a provisional leader (default: true)",
      }),
      throughput: Schema.optional(Schema.Boolean).annotate({
        description: "Allow the provisional leader to be replaced by a faster model (default: true)",
      }),
      toolCall: Schema.optional(Schema.Boolean).annotate({
        description: "Lock the race when a candidate emits a complete tool call (default: true)",
      }),
    }),
  ),
  throughput: Schema.optional(
    Schema.Struct({
      warmupTokens: Schema.optional(PositiveInt).annotate({
        description: "Tokens ignored before throughput measurement starts (default: 8)",
      }),
      measurementWindowMs: Schema.optional(PositiveInt).annotate({
        description: "Duration of each throughput measurement window in milliseconds (default: 1000)",
      }),
    }),
  ),
  switch: Schema.optional(
    Schema.Struct({
      enabled: Schema.optional(Schema.Boolean).annotate({
        description: "Allow switching the provisional leader after throughput measurement (default: true)",
      }),
    }),
  ),
}).annotate({ identifier: "ModelRaceConfig" })

export type Info = Schema.Schema.Type<typeof Info>

export type Normalized = {
  enabled: boolean
  models: string[]
  strategy: {
    firstToken: boolean
    throughput: boolean
    toolCall: boolean
  }
  throughput: {
    warmupTokens: number
    measurementWindowMs: number
  }
  switch: {
    enabled: boolean
  }
}

export const defaults: Normalized = {
  enabled: false,
  models: [],
  strategy: {
    firstToken: true,
    throughput: true,
    toolCall: true,
  },
  throughput: {
    warmupTokens: 8,
    measurementWindowMs: 1000,
  },
  switch: {
    enabled: true,
  },
}

export function normalize(input?: Info): Normalized {
  return {
    enabled: input?.enabled ?? defaults.enabled,
    models: [...new Set(input?.models ?? defaults.models)],
    strategy: {
      firstToken: input?.strategy?.firstToken ?? defaults.strategy.firstToken,
      throughput: input?.strategy?.throughput ?? defaults.strategy.throughput,
      toolCall: input?.strategy?.toolCall ?? defaults.strategy.toolCall,
    },
    throughput: {
      warmupTokens: input?.throughput?.warmupTokens ?? defaults.throughput.warmupTokens,
      measurementWindowMs: input?.throughput?.measurementWindowMs ?? defaults.throughput.measurementWindowMs,
    },
    switch: {
      enabled: input?.switch?.enabled ?? defaults.switch.enabled,
    },
  }
}

export function validate(input: Normalized) {
  const errors: string[] = []
  if (input.enabled && input.models.length < 2) errors.push("Select at least two candidate models")
  if (input.models.some((model) => model.indexOf("/") <= 0))
    errors.push("Candidate models must use provider/model format")
  if (!Number.isInteger(input.throughput.warmupTokens) || input.throughput.warmupTokens <= 0)
    errors.push("Warmup tokens must be a positive integer")
  if (!Number.isInteger(input.throughput.measurementWindowMs) || input.throughput.measurementWindowMs <= 0)
    errors.push("Measurement window must be a positive integer")
  return errors
}
