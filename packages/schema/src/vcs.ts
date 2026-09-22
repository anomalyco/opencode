export * as Vcs from "./vcs.js"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "./schema.js"

export const Branch = Schema.Struct({
  current: optional(Schema.String),
  default: optional(Schema.String),
}).annotate({ identifier: "Vcs.Branch" })
export interface Branch extends Schema.Schema.Type<typeof Branch> {}

export const Info = Schema.Struct({
  provider: optional(Schema.String),
  branch: Branch,
}).annotate({ identifier: "Vcs.Info" })
export interface Info extends Schema.Schema.Type<typeof Info> {}

export const BranchList = Schema.Array(Schema.String).annotate({ identifier: "Vcs.BranchList" })
export type BranchList = typeof BranchList.Type

export const Base = Schema.Struct({
  name: Schema.String,
  ref: Schema.String,
  source: Schema.Literals(["reflog", "default"]),
}).annotate({ identifier: "Vcs.Base" })
export interface Base extends Schema.Schema.Type<typeof Base> {}

export const Mode = Schema.Literals(["working", "branch", "committed"]).annotate({ identifier: "Vcs.Mode" })
export type Mode = typeof Mode.Type

export const FileStatus = Schema.Struct({
  file: Schema.String,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
  status: Schema.Literals(["added", "deleted", "modified"]),
}).annotate({ identifier: "Vcs.FileStatus" })
export interface FileStatus extends Schema.Schema.Type<typeof FileStatus> {}

export const GraphRef = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["branch", "remote", "tag", "head"]),
}).annotate({ identifier: "Vcs.GraphRef" })
export interface GraphRef extends Schema.Schema.Type<typeof GraphRef> {}

export const GraphCommit = Schema.Struct({
  hash: Schema.String,
  parents: Schema.Array(Schema.String),
  refs: Schema.Array(GraphRef),
  subject: Schema.String,
  authorName: Schema.NullOr(Schema.String),
  authoredAtMs: Schema.NullOr(Schema.Finite),
}).annotate({ identifier: "Vcs.GraphCommit" })
export interface GraphCommit extends Schema.Schema.Type<typeof GraphCommit> {}

export const GraphPage = Schema.Struct({
  commits: Schema.Array(GraphCommit),
  hasMore: Schema.Boolean,
}).annotate({ identifier: "Vcs.GraphPage" })
export interface GraphPage extends Schema.Schema.Type<typeof GraphPage> {}
