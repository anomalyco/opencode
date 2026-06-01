import { EventV2 } from "@opencode-ai/core/event"
import { Schema } from "effect"

export const Event = {
  Connected: EventV2.define({ type: "server.connected", schema: {} }),
  Disposed: EventV2.define({ type: "global.disposed", schema: {} }),
}

export const InstanceDisposed = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("server.instance.disposed"),
  properties: Schema.Struct({ directory: Schema.String }),
}).annotate({ identifier: "Event.server.instance.disposed" })
