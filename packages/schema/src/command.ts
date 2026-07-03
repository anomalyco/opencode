export * as Command from "./command.js"

import { Schema } from "effect"
import { define, inventory } from "./event.js"
import { optional } from "./schema.js"
import { Model } from "./model.js"

const Updated = define({ type: "command.updated", schema: {} })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  name: Schema.String,
  template: Schema.String,
  description: Schema.String.pipe(optional),
  agent: Schema.String.pipe(optional),
  model: Model.Ref.pipe(optional),
  subtask: Schema.Boolean.pipe(optional),
}).annotate({ identifier: "CommandV2.Info" })

export const Event = {
  Updated,
  Definitions: inventory(Updated),
}
