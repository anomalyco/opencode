import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { statics } from "@opencode-ai/core/schema"

export const EventID = Schema.String.check(Schema.isStartsWith("evt")).pipe(
  Schema.brand("EventID"),
  statics((s) => ({
    ascending: (id?: string) => s.make(Identifier.ascending("event", id)),
  })),
)
