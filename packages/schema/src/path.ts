export * as Path from "./path.js"

import { Schema } from "effect"
import { AbsolutePath } from "./schema.js"

export const Info = Schema.Struct({
  home: AbsolutePath,
  state: AbsolutePath,
  config: AbsolutePath,
  worktree: AbsolutePath,
  directory: AbsolutePath,
}).annotate({ identifier: "Path.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}
