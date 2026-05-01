import { Schema } from "effect"
import z from "zod"
import { zod, ZodOverride } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

// The original Zod schema carried an external $ref pointing at the models.dev
// JSON schema. That external reference is not a named SDK component — it is a
// literal pointer to an outside schema — so the walker cannot re-derive it
// from AST metadata. Preserve the exact original Zod via ZodOverride.
export const ConfigModelID = Schema.String.annotate({
  [ZodOverride]: z.string().meta({ $ref: "https://models.dev/model-schema.json#/$defs/Model" }),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export type ConfigModelID = Schema.Schema.Type<typeof ConfigModelID>
