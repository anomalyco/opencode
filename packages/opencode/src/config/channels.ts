export * as ConfigChannels from "./channels"

import { Schema } from "effect"

export const Channels = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "ChannelsConfig" })
