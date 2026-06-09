export * as ConfigCommand from "./command"

import { Schema } from "effect"

export class Info extends Schema.Class<Info>("ConfigV2.Command")({
  template: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  agent: Schema.String.pipe(Schema.optional),
  model: Schema.String.pipe(Schema.optional),
  variant: Schema.String.pipe(Schema.optional),
  subtask: Schema.Boolean.pipe(Schema.optional),
}) {}
