export * as Command from "./command.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"
import { optional } from "./schema.js"
import { SessionMessage } from "./session-message.js"

const Updated = ephemeral({ type: "command.updated", schema: {} })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.String.pipe(optional),
}).annotate({ identifier: "Command.Info" })

/**
 * What a command did when invoked. `immediate` commands finish inside the request;
 * `prompt` commands durably admitted session input whose resulting work clients
 * follow through the invocation message ID.
 */
export const Outcome = Schema.Union([
  Schema.Struct({ type: Schema.tag("immediate") }),
  Schema.Struct({
    type: Schema.tag("prompt"),
    inboxID: SessionMessage.ID.annotate({
      description: "Admitted inbox item ID. Must equal the invocation message ID.",
    }),
  }),
]).pipe(Schema.toTaggedUnion("type"), Schema.annotate({ identifier: "Command.Outcome" }))
export type Outcome = typeof Outcome.Type

export const Event = {
  Updated,
  Definitions: inventory(Updated),
}
