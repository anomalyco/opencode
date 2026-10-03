export * as ConfigSkillsV1 from "./skills"

import { Schema } from "effect"

export const Info = Schema.Struct({
  paths: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Additional paths to skill folders",
  }),
  urls: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "URLs to fetch skills from (e.g., https://example.com/.well-known/skills/)",
  }),
  disabled: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Skills that are disabled at startup. Disabled skills are hidden from the model and slash commands but remain listed so they can be re-enabled.",
  }),
})
export type Info = Schema.Schema.Type<typeof Info>
