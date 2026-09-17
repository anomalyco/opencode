import { Schema } from "effect"
import { ServerEvent } from "@opencode-ai/schema/server-event"

export const Event = ServerEvent

export const InstanceDisposed = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("server.instance.disposed"),
  properties: Schema.Struct({ directory: Schema.String }),
}).annotate({ identifier: "Event.server.instance.disposed" })
