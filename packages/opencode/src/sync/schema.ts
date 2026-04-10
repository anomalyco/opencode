import { Schema } from "effect"
import z from "zod"

import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

export const EventID = Schema.String.pipe(
  Schema.brand("EventID"),
  withStatics((s) => ({
    make: (id: string) => s.makeUnsafe(id),
    ascending: (id?: string) => s.makeUnsafe(Identifier.ascending("event", id)),
    zod: Identifier.schema("event").pipe(z.custom<Schema.Schema.Type<typeof s>>()),
  })),
)
