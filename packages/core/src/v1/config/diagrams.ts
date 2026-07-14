export * as ConfigDiagramsV1 from "./diagrams"

import { Schema } from "effect"
import type { DeepMutable } from "../../schema"

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable Mermaid diagram rendering (default: false)",
  }),
  format: Schema.optional(Schema.Literals(["svg", "png", "ascii"])).annotate({
    description: "Output format for rendered diagrams (default: svg)",
  }),
}).annotate({ identifier: "DiagramsConfig" })
export type Info = DeepMutable<Schema.Schema.Type<typeof Info>>
