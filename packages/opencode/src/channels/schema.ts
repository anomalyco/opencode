import { Schema } from "effect"

export const ChannelID = Schema.String.pipe(Schema.brand("ChannelID"))

export const ChannelType = Schema.String.pipe(Schema.brand("ChannelType"))

export const ChannelInfo = Schema.Struct({
  id: ChannelID,
  type: ChannelType,
  name: Schema.String,
  enabled: Schema.Boolean,
  config: Schema.optional(Schema.Unknown),
  created_at: Schema.Number,
  updated_at: Schema.Number,
})

export const CreateChannel = Schema.Struct({
  type: ChannelType,
  name: Schema.String,
  enabled: Schema.optional(Schema.Boolean),
  config: Schema.optional(Schema.Unknown),
})

export * as ChannelSchema from "./schema"
