import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { zod, ZodOverride } from "@opencode-ai/core/effect-zod"
import { withStatics } from "@opencode-ai/core/schema"

export const EventID = Schema.String.annotate({ [ZodOverride]: Identifier.schema("event") }).pipe(
  Schema.brand("EventID"),
  withStatics((s) => ({
    ascending: (id?: string) => s.make(Identifier.ascending("event", id)),
    zod: zod(s),
  })),
)
