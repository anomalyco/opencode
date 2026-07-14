export * as ConfigTestingV1 from "./testing"

import { Schema } from "effect"
import { NonNegativeInt, type DeepMutable } from "../../schema"

export const Info = Schema.Struct({
  testCommand: Schema.optional(Schema.String).annotate({
    description: "Command to run tests (default: determined from package.json or 'bun test')",
  }),
  framework: Schema.optional(Schema.String).annotate({
    description: "Test framework to use for test generation: vitest, jest, mocha, bun (default: auto-detect)",
  }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable test generation features (default: true)",
  }),
  maxFixIterations: Schema.optional(NonNegativeInt).annotate({
    description: "Maximum fix iterations when generated tests fail (default: 2)",
  }),
}).annotate({ identifier: "TestingConfig" })
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>
