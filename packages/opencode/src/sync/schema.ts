import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { zod } from "@opencode-ai/core/effect-zod"
import { withStatics } from "@opencode-ai/core/schema"

export const EventID = Schema.String.check(Schema.isStartsWith("evt")).pipe(
  Schema.brand("EventID"),
  withStatics((s) => ({
    ascending: (id?: string) => s.make(Identifier.ascending("event", id)),
    zod: zod(s),
  })),
)
