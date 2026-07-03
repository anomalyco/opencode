export * as Vcs from "./vcs.js"

import { Schema } from "effect"
import { NonNegativeInt } from "./schema.js"

export const Mode = Schema.Literals(["working", "branch"]).annotate({ identifier: "Vcs.Mode" })
export type Mode = typeof Mode.Type

export const FileStatus = Schema.Struct({
  file: Schema.String,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  status: Schema.Literals(["added", "deleted", "modified"]),
}).annotate({ identifier: "Vcs.FileStatus" })
export interface FileStatus extends Schema.Schema.Type<typeof FileStatus> {}
