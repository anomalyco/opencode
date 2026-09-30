import { Schema } from "effect"

export const MenuCommand = Schema.Union([
  Schema.Struct({ type: Schema.Literal("command"), id: Schema.String }),
  Schema.Struct({ type: Schema.Literal("home") }),
  Schema.Struct({ type: Schema.Literal("session"), sessionID: Schema.String }),
])
export type MenuCommand = typeof MenuCommand.Type
