export * as TerminalTray from "./terminal-tray.js"

import { Schema } from "effect"

export const Connection = Schema.Struct({
  id: Schema.String,
  url: Schema.String.check(Schema.isPattern(/^http:\/\/127\.0\.0\.1:\d+$/)),
  token: Schema.String,
}).annotate({ identifier: "TerminalTray.Connection" })
export interface Connection extends Schema.Schema.Type<typeof Connection> {}

export const State = Schema.Struct({
  enabled: Schema.Boolean,
  focused: Schema.Boolean,
  sessions: Schema.Array(Schema.String),
  current: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "TerminalTray.State" })
export interface State extends Schema.Schema.Type<typeof State> {}

export const Snapshot = Schema.Struct({
  ...State.fields,
  server: Schema.Struct({
    url: Schema.String,
    auth: Schema.optionalKey(
      Schema.Struct({
        type: Schema.Literal("basic"),
        username: Schema.String,
        password: Schema.String,
      }),
    ),
  }),
}).annotate({ identifier: "TerminalTray.Snapshot" })
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}

export const Command = Schema.Union([
  Schema.Struct({ type: Schema.Literal("session"), sessionID: Schema.String }),
  Schema.Struct({ type: Schema.Literals(["new", "settings", "focus"]) }),
]).annotate({ identifier: "TerminalTray.Command" })
export type Command = typeof Command.Type
