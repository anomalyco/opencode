export * as ConfigSkillsV1 from "./skills"

import { Schema } from "effect"

export const Info = Schema.Struct({
  paths: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Additional paths to skill folders",
  }),
  urls: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "URLs to fetch skills from (e.g., https://example.com/.well-known/skills/)",
  }),
  autoLoad: Schema.optional(Schema.Literals(["all", "core", "none"])).annotate({
    description:
      'Control which skills are auto-loaded into the system prompt: "all" (default) loads all skills, "core" loads only core-tagged skills, "none" loads no skills at startup',
  }),
})
export type Info = Schema.Schema.Type<typeof Info>
