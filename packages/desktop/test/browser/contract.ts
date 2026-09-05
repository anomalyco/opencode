import { Rpc } from "@opencode-ai/schema/rpc"
import { Session } from "@opencode-ai/schema/session"
import { Schema } from "effect"

export const Smoke = Rpc.define({
  id: "browser.smoke",
  methods: {
    execute: {
      input: Schema.Struct({ sessionID: Session.ID, code: Schema.String }),
      output: Schema.Struct({ output: Schema.String, error: Schema.optionalKey(Schema.Boolean) }),
    },
    write: { input: Schema.Struct({ text: Schema.String }), output: Schema.String },
    read: { input: Schema.Struct({ path: Schema.String }), output: Schema.String },
    deny: { input: Schema.Struct({ urls: Schema.Array(Schema.String) }), output: Schema.Void },
  },
  events: {},
})
