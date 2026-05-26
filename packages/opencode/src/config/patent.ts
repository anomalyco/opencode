import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { ConfigModelID } from "./model-id"
import { ConfigPermission } from "./permission"

export const PatentAgentConfig = Schema.Struct({
  disable: Schema.optional(Schema.Boolean),
  model: Schema.optional(ConfigModelID),
  temperature: Schema.optional(Schema.Finite),
  top_p: Schema.optional(Schema.Finite),
  prompt: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  steps: Schema.optional(Schema.Number),
  permission: Schema.optional(ConfigPermission.Info),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type PatentAgentConfig = Schema.Schema.Type<typeof PatentAgentConfig>

export const PatentSearchConfig = Schema.Struct({
  backend: Schema.optional(Schema.Union([Schema.Literal("none"), Schema.Literal("local"), Schema.Literal("google"), Schema.Literal("custom")])),
  connectionString: Schema.optional(Schema.String),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type PatentSearchConfig = Schema.Schema.Type<typeof PatentSearchConfig>

export const PatentQualityConfig = Schema.Struct({
  threshold: Schema.optional(Schema.Number),
  maxIterations: Schema.optional(Schema.Number),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type PatentQualityConfig = Schema.Schema.Type<typeof PatentQualityConfig>

export const Info = Schema.Struct({
  dataDir: Schema.optional(Schema.String),
  search: Schema.optional(PatentSearchConfig),
  quality: Schema.optional(PatentQualityConfig),
  agent: Schema.optional(Schema.Record(Schema.String, PatentAgentConfig)),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>

export * as ConfigPatent from "./patent"