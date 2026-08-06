export * as ConfigCommand from "./command.js"

import { Schema } from "effect"
import { ConfigModel } from "./model.js"

export class Info extends Schema.Class<Info>("Config.Command")({
  template: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  agent: Schema.String.pipe(Schema.optional),
  model: ConfigModel.Selection.pipe(Schema.optional),
  subtask: Schema.Boolean.pipe(Schema.optional),
}) {}
