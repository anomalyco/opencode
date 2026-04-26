import { Schema } from "effect"
import z from "zod"

import { Identifier } from "@/id/id"
import { ZodOverride } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

const ptyIdSchema = Schema.String.annotate({ [ZodOverride]: Identifier.schema("pty") }).pipe(Schema.brand("PtyID"))

export type PtyID = typeof ptyIdSchema.Type

export const PtyID = ptyIdSchema.pipe(
  withStatics((schema: typeof ptyIdSchema) => ({
    ascending: (id?: string) => schema.make(Identifier.ascending("pty", id)),
    zod: Identifier.schema("pty").pipe(z.custom<PtyID>()),
  })),
)
