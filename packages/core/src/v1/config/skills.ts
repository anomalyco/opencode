export * as ConfigSkillsV1 from "./skills"

import { Schema } from "effect"

export const Source = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  enabled: Schema.optional(Schema.Boolean),
})
export type Source = Schema.Schema.Type<typeof Source>

export const Collision = Schema.Union([Schema.Literal("last-wins"), Schema.Literal("source-qualified")])
export type Collision = Schema.Schema.Type<typeof Collision>

export const Info = Schema.Struct({
  paths: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Additional paths to skill folders",
  }),
  urls: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "URLs to fetch skills from (e.g., https://example.com/.well-known/skills/)",
  }),
  sources: Schema.optional(Schema.Array(Source)).annotate({
    description: "Explicit skill source directories",
  }),
  collision: Schema.optional(Collision).annotate({
    description: "How same-named skills from explicit sources are exposed",
  }),
})
export type Info = Schema.Schema.Type<typeof Info>
