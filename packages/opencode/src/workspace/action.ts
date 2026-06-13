export * as WorkspaceAction from "./action"

import { EventV2 } from "@cedric/core/event"
import { SessionID } from "@/session/schema"
import { Schema } from "effect"

const OpenFile = Schema.Struct({
  type: Schema.Literal("openFile"),
  path: Schema.String,
  title: Schema.optional(Schema.String),
  activate: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "WorkspaceOpenFileAction" })

const OpenBrowser = Schema.Struct({
  type: Schema.Literal("openBrowser"),
  url: Schema.String,
  title: Schema.optional(Schema.String),
  activate: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "WorkspaceOpenBrowserAction" })

const OpenTerminal = Schema.Struct({
  type: Schema.Literal("openTerminal"),
  title: Schema.optional(Schema.String),
  activate: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "WorkspaceOpenTerminalAction" })

export const Action = Schema.Union([OpenFile, OpenBrowser, OpenTerminal]).annotate({ identifier: "WorkspaceAction" })
export type Action = typeof Action.Type

export const Event = {
  Requested: EventV2.define({
    type: "workspace.action.requested",
    schema: {
      sessionID: SessionID,
      action: Action,
    },
  }),
}
