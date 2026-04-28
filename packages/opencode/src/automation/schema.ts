import { Schema } from "effect"
import { Identifier } from "@/id/id"
import { zod, ZodOverride } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

export const AutomationID = Schema.String.annotate({ [ZodOverride]: Identifier.schema("automation") }).pipe(
  Schema.brand("AutomationID"),
  withStatics((s) => ({
    ascending: (id?: string) => s.make(Identifier.ascending("automation", id)),
    zod: zod(s),
  })),
)
export type AutomationID = Schema.Schema.Type<typeof AutomationID>

export const AutomationRunID = Schema.String.annotate({ [ZodOverride]: Identifier.schema("automationRun") }).pipe(
  Schema.brand("AutomationRunID"),
  withStatics((s) => ({
    ascending: (id?: string) => s.make(Identifier.ascending("automationRun", id)),
    zod: zod(s),
  })),
)
export type AutomationRunID = Schema.Schema.Type<typeof AutomationRunID>

export const AutomationFindingID = Schema.String.annotate({
  [ZodOverride]: Identifier.schema("automationFinding"),
}).pipe(
  Schema.brand("AutomationFindingID"),
  withStatics((s) => ({
    ascending: (id?: string) => s.make(Identifier.ascending("automationFinding", id)),
    zod: zod(s),
  })),
)
export type AutomationFindingID = Schema.Schema.Type<typeof AutomationFindingID>
