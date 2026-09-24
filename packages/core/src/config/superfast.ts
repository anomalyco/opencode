export * as ConfigSuperfast from "./superfast"

import { Schema } from "effect"

export class Info extends Schema.Class<Info>("ConfigV2.Superfast")({
  enabled: Schema.Boolean.pipe(Schema.optional),
  endpoint: Schema.String.pipe(Schema.optional),
  model: Schema.String.pipe(Schema.optional),
  timeout_ms: Schema.Number.pipe(Schema.optional),
}) {}
