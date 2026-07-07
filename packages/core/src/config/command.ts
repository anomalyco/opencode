export * as ConfigCommand from "./command"

import { Schema } from "effect"
import { ConfigModel } from "./model"

export class Info extends Schema.Class<Info>("ConfigV2.Command")({
  template: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  agent: Schema.String.pipe(Schema.optional),
  model: ConfigModel.Selection.pipe(Schema.optional),
  subtask: Schema.Boolean.pipe(Schema.optional),
}) {}
