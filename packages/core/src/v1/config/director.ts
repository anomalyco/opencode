export * as ConfigDirectorV1 from "./director"

import { Effect, Schema } from "effect"
import { NonNegativeInt, type DeepMutable } from "../../schema"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ).annotate({
    description: "Enable the Director agent mode (default: true)",
  }),
  maxWorkers: Schema.optional(NonNegativeInt).pipe(
    Schema.withDecodingDefault(Effect.succeed(5)),
  ).annotate({
    description: "Maximum number of concurrent worker agents (default: 5)",
  }),
  reviewRequired: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ).annotate({
    description: "Require director review of all completed work (default: true)",
  }),
  statsEnabled: Schema.optional(Schema.Boolean).pipe(
    Schema.withDecodingDefault(Effect.succeed(true)),
  ).annotate({
    description: "Enable worker performance statistics tracking (default: true)",
  }),
  minSuccessRate: Schema.optional(Schema.Finite).pipe(
    Schema.withDecodingDefault(Effect.succeed(0.6)),
  ).annotate({
    description: "Minimum success rate (0-1) for workers; below this, director replaces them (default: 0.6)",
  }),
}).annotate({ identifier: "DirectorConfig" })
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>
