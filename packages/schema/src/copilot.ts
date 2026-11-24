export * as Copilot from "./copilot.js"

import { Schema } from "effect"
import { Rpc } from "./rpc.js"

export const Definition = Rpc.define({
  id: "experimental.github-copilot",
  methods: {
    catalogReady: {
      input: Schema.toStandardSchemaV1(Schema.Undefined),
      output: Schema.toStandardSchemaV1(Schema.Boolean),
    },
  },
  events: {},
})
