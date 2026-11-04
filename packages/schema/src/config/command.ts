export * as ConfigCommand from "./command.js"

import { Schema } from "effect"
import { optional } from "../schema.js"
import { ConfigModel } from "./model.js"

export class Info extends Schema.Class<Info>("Config.Command")({
  template: Schema.String,
  description: Schema.String.pipe(optional),
  agent: Schema.String.pipe(optional),
  model: ConfigModel.Selection.pipe(optional),
  subagent: Schema.Boolean.pipe(optional),
  subtask: Schema.Boolean.annotate({ description: "Deprecated alias for subagent." }).pipe(optional),
}) {}
