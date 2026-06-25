export * as Command from "./command"

import { Schema } from "effect"
import { Model } from "./model"

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  name: Schema.String,
  template: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  agent: Schema.String.pipe(Schema.optional),
  model: Model.Ref.pipe(Schema.optional),
  subtask: Schema.Boolean.pipe(Schema.optional),
}).annotate({ identifier: "CommandV2.Info" })
