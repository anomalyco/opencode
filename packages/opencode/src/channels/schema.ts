import { Schema } from "effect"

export const ChannelID = Schema.String.pipe(Schema.brand("ChannelID"))

export const ChannelType = Schema.Literals(["slack", "discord"])

export const ChannelInfo = Schema.Struct({
  id: ChannelID,
  type: ChannelType,
  name: Schema.String,
  webhook_url: Schema.String,
  enabled: Schema.Boolean,
  created_at: Schema.Number,
  updated_at: Schema.Number,
})

export const CreateChannel = Schema.Struct({
  type: ChannelType,
  name: Schema.String,
  webhook_url: Schema.String,
  enabled: Schema.optional(Schema.Boolean),
})

export * as ChannelSchema from "./schema"
