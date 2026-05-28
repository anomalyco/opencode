import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { withStatics } from "@simpliciocode/core/schema"

export const EventID = Schema.String.check(Schema.isStartsWith("evt")).pipe(
  Schema.brand("EventID"),
  withStatics((s) => ({
    ascending: (id?: string) => s.make(Identifier.ascending("event", id)),
  })),
)
