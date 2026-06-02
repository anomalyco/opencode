import { Schema } from "effect"
import { BusEvent } from "@/bus/bus-event"
import { ChannelID, ChannelType } from "./schema"

export const ChannelCreated = BusEvent.define("channel.created", Schema.Struct({
  channel_id: ChannelID,
  type: ChannelType,
  name: Schema.String,
}))

export const ChannelRemoved = BusEvent.define("channel.removed", Schema.Struct({
  channel_id: ChannelID,
}))

export const ChannelMessageSent = BusEvent.define("channel.message.sent", Schema.Struct({
  channel_id: ChannelID,
  ok: Schema.Boolean,
}))

export const ChannelMessageFailed = BusEvent.define("channel.message.failed", Schema.Struct({
  channel_id: ChannelID,
  error: Schema.String,
}))

export * as ChannelBusEvents from "./bus-events"
