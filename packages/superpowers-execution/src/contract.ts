import { Rpc } from "@opencode/schema/rpc"
import { z } from "zod"
import {
  ChangedSchema,
  ErrorSchema,
  IdentifierSchema,
  RunSnapshotSchema,
  RunSummarySchema,
} from "./schema"

export * from "./schema"
export { summarizeProgress } from "./progress"

const errors = { execution: ErrorSchema }

export const readMethods = {
  capabilities: {
    input: z.strictObject({}),
    output: z.strictObject({
      schemaVersion: z.literal(1),
      pluginVersion: z.string(),
      maxTasks: z.literal(500),
      reporting: z.literal("controller"),
    }),
    errors,
  },
  listRuns: {
    input: z.strictObject({
      rootSessionID: IdentifierSchema,
      after: IdentifierSchema.optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    output: z.strictObject({ items: z.array(RunSummarySchema), next: IdentifierSchema.optional() }),
    errors,
  },
  getRun: {
    input: z.strictObject({ rootSessionID: IdentifierSchema, runID: IdentifierSchema }),
    output: RunSnapshotSchema,
    errors,
  },
  getSummaries: {
    input: z.strictObject({ rootSessionIDs: z.array(IdentifierSchema).max(50) }),
    output: z.strictObject({ items: z.array(RunSummarySchema) }),
    errors,
  },
}

export const ExecutionRpc = Rpc.define({
  id: "superpowers.execution.v1",
  methods: readMethods,
  events: { changed: { schema: ChangedSchema } },
})
