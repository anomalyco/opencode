import { Schema } from "effect"
import { zod } from "@opencode-ai/core/effect-zod"
import { NonNegativeInt } from "@opencode-ai/core/schema"

export class ConsoleState extends Schema.Class<ConsoleState>("ConsoleState")({
  consoleManagedProviders: Schema.mutable(Schema.Array(Schema.String)),
  activeOrgName: Schema.optional(Schema.String),
  switchableOrgCount: NonNegativeInt,
}) {
  static readonly zod = zod(this)
}

export const emptyConsoleState: ConsoleState = ConsoleState.make({
  consoleManagedProviders: [],
  activeOrgName: undefined,
  switchableOrgCount: 0,
})
