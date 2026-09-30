import { Schema } from "effect"

export const TrayAvatar = Schema.Struct({
  name: Schema.String,
  source: Schema.optionalKey(Schema.String),
  background: Schema.String,
  border: Schema.String,
  foreground: Schema.String,
  highlight: Schema.String,
  accent: Schema.String,
})
export type TrayAvatar = typeof TrayAvatar.Type
