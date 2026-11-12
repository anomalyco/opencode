export * as LocalModel from "./local-model.js"

import { Schema } from "effect"
import { Rpc } from "./rpc.js"

/**
 * The local-model plugin's RPC. `/clear` and `/exit` call `unload` with the chat's provider and model.
 * The server sends the request, so a remote TUI does not talk to its own loopback. The schemas are Standard
 * Schemas too, so Promise clients can call it.
 */
export const Definition = Rpc.define({
  id: "opencode.local-model",
  methods: {
    unload: {
      input: Schema.toStandardSchemaV1(
        Schema.Struct({
          providerID: Schema.String,
          modelID: Schema.String,
        }),
      ),
      output: Schema.toStandardSchemaV1(Schema.Struct({ unloaded: Schema.Boolean })),
    },
  },
  events: {},
})
