export * as LegacyEvent from "./legacy-event.js"

import { Schema } from "effect"
import { define, inventory } from "../event.js"
import { SessionID } from "../session-id.js"
import { SessionV1 } from "./session.js"

export const CommandExecuted = define({
  type: "command.executed",
  schema: {
    name: Schema.String,
    sessionID: SessionID,
    arguments: Schema.String,
    messageID: SessionV1.MessageID,
  },
})

export const Definitions = inventory(CommandExecuted)
