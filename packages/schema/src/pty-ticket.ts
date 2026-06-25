export * as PtyTicket from "./pty-ticket"

import { Schema } from "effect"
import { PositiveInt } from "./schema"

export const ConnectToken = Schema.Struct({
  ticket: Schema.String,
  expires_in: PositiveInt,
})
