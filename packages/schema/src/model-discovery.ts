export * as ModelDiscovery from "./model-discovery.js"

import { Schema } from "effect"
import { Rpc } from "./rpc.js"

export const Definition = Rpc.define({
  id: "experimental.model-discovery",
  methods: {
    ready: {
      input: Schema.toStandardSchemaV1(Schema.Undefined),
      output: Schema.toStandardSchemaV1(Schema.Boolean),
    },
  },
  events: {},
})
