import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

const Paths = Schema.Struct({
  paths: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Additional paths to skill folders",
  }),
  urls: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "URLs to fetch skills from (e.g., https://example.com/.well-known/skills/)",
  }),
})

const LegacyItem = Schema.StructWithRest(
  Schema.Struct({
    name: Schema.String,
    description: Schema.String,
    command: Schema.String,
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

export const Info = Schema.Union(Schema.Array(LegacyItem), Paths).pipe(withStatics((s) => ({ zod: zod(s) })))

export type Info = Schema.Schema.Type<typeof Info>

export * as ConfigSkills from "./skills"
