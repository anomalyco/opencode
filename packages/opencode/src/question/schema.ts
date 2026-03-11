import { Schema } from "effect"
import z from "zod"

import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"

const questionIdSchema = Schema.String.pipe(Schema.brand("QuestionId"))

export type QuestionID = typeof questionIdSchema.Type

export const QuestionID = questionIdSchema.pipe(
  withStatics((schema: typeof questionIdSchema) => ({
    make: (id: string) => schema.makeUnsafe(id),
    ascending: (id?: string) => schema.makeUnsafe(Identifier.ascending("question", id)),
    zod: z.string().startsWith("qst").pipe(z.custom<QuestionID>()),
  })),
)
