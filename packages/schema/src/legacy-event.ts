export * as LegacyEvent from "./legacy-event"

import { Schema } from "effect"
import { define } from "./event"
import { Project } from "./project"
import { Session } from "./session"
import { SessionV1 } from "./session-v1"

export const ProjectUpdated = define({ type: "project.updated", schema: Project.Info.fields })

export const CommandExecuted = define({
  type: "command.executed",
  schema: {
    name: Schema.String,
    sessionID: Session.ID,
    arguments: Schema.String,
    messageID: SessionV1.MessageID,
  },
})
