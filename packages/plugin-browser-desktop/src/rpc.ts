export * as BrowserDesktop from "./rpc.js"
import { Rpc } from "@opencode/schema/rpc"
import { Browser } from "@opencode/plugin-browser/rpc"
import { Schema } from "effect"

export const Event = Schema.Union([
  Schema.Struct({ type: Schema.Literal("focus"), tabID: Browser.TabID }),
  Schema.Struct({
    type: Schema.Literal("state"),
    state: Schema.NullOr(Browser.State),
    surfaces: Schema.Record(Schema.String, Schema.String),
    error: Schema.optionalKey(Schema.String),
  }),
])
export type Event = typeof Event.Type
export const Definition = Rpc.define({
  id: "browser.desktop",
  methods: {
    register: {
      input: Schema.Struct({ bindingID: Schema.String, sessionID: Schema.String, serverID: Schema.String }),
      output: Schema.Null,
    },
    command: { input: Schema.Struct({ bindingID: Schema.String, action: Browser.Action }), output: Schema.Null },
    close: { input: Schema.Struct({ bindingID: Schema.String }), output: Schema.Null },
  },
  events: { changed: { schema: Schema.Struct({ bindingID: Schema.String, event: Event }) } },
})
