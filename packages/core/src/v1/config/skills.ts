export * as ConfigSkillsV1 from "./skills"

import { Schema } from "effect"

// External project/global directories KanCode can scan for skills in addition
// to .kancode/. External skill discovery is opt-in: a source is only scanned
// when explicitly listed in the `external` config field. Keep in sync with
// EXTERNAL_DIRS in src/skill/index.ts.
export const EXTERNAL_SOURCES = [".claude", ".agents", ".cursor", ".codex", ".kilo", ".opencode"] as const
export type ExternalSource = (typeof EXTERNAL_SOURCES)[number]

export const ExternalSource = Schema.Union([
  Schema.Literal(".claude"),
  Schema.Literal(".agents"),
  Schema.Literal(".cursor"),
  Schema.Literal(".codex"),
  Schema.Literal(".kilo"),
  Schema.Literal(".opencode"),
]).annotate({
  description:
    "External skill source to enable: one of .claude, .agents, .cursor, .codex, .kilo, .opencode",
})

export const Info = Schema.Struct({
  paths: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Additional paths to skill folders",
  }),
  urls: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "URLs to fetch skills from (e.g., https://example.com/.well-known/skills/)",
  }),
  external: Schema.optional(Schema.Array(ExternalSource)).annotate({
    description:
      "External skill sources to enable. Default: none. List a source dir (e.g. \".codex\", \".claude\") to scan it for skills. External skills are opt-in; sources not listed here are ignored.",
  }),
})
export type Info = Schema.Schema.Type<typeof Info>
