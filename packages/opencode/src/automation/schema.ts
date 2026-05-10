import { Schema } from "effect"
import { Identifier } from "@/id/id"
import { withStatics } from "@opencode-ai/core/schema"

const automationIdSchema = Schema.String.check(Schema.isStartsWith("aut")).pipe(Schema.brand("AutomationID"))
export type AutomationID = typeof automationIdSchema.Type

export const AutomationID = automationIdSchema.pipe(
  withStatics((schema: typeof automationIdSchema) => ({
    ascending: (id?: string) => schema.make(Identifier.ascending("automation", id)),
  })),
)

const automationRunIdSchema = Schema.String.check(Schema.isStartsWith("arn")).pipe(Schema.brand("AutomationRunID"))
export type AutomationRunID = typeof automationRunIdSchema.Type

export const AutomationRunID = automationRunIdSchema.pipe(
  withStatics((schema: typeof automationRunIdSchema) => ({
    ascending: (id?: string) => schema.make(Identifier.ascending("automationRun", id)),
  })),
)

const automationFindingIdSchema = Schema.String.check(Schema.isStartsWith("afn")).pipe(
  Schema.brand("AutomationFindingID"),
)
export type AutomationFindingID = typeof automationFindingIdSchema.Type

export const AutomationFindingID = automationFindingIdSchema.pipe(
  withStatics((schema: typeof automationFindingIdSchema) => ({
    ascending: (id?: string) => schema.make(Identifier.ascending("automationFinding", id)),
  })),
)
