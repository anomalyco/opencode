export * as ConfigSandbox from "./sandbox"

import { Schema } from "effect"

export const Info = Schema.Struct({
  type: Schema.Literal("docker"),
  image: Schema.String,
}).annotate({ identifier: "SandboxConfig" })

export type Info = typeof Info.Type
