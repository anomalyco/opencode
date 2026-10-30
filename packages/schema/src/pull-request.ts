export * as PullRequest from "./pull-request.js"

import { Schema } from "effect"
import { Rpc } from "./rpc.js"
import { optional, PositiveInt } from "./schema.js"

export const Link = Schema.String.check(Schema.isPattern(/^https?:\/\/\S+$/u)).annotate({
  identifier: "PullRequest.Link",
})

export const Check = Schema.Struct({
  name: Schema.String,
  state: Schema.Literals(["success", "failure", "pending", "neutral", "unknown"]),
  url: optional(Link),
}).annotate({ identifier: "PullRequest.Check" })
export interface Check extends Schema.Schema.Type<typeof Check> {}

export const Review = Schema.Struct({
  author: Schema.String,
  state: Schema.String,
  commit: Schema.NullOr(Schema.String),
  url: Link,
}).annotate({ identifier: "PullRequest.Review" })
export interface Review extends Schema.Schema.Type<typeof Review> {}

export const Thread = Schema.Struct({
  path: Schema.String,
  line: Schema.NullOr(PositiveInt),
  outdated: Schema.Boolean,
  author: Schema.String,
  body: Schema.String,
  url: Link,
}).annotate({ identifier: "PullRequest.Thread" })
export interface Thread extends Schema.Schema.Type<typeof Thread> {}

export const Snapshot = Schema.Struct({
  status: Schema.Literal("available"),
  branch: Schema.String,
  localHead: Schema.String,
  number: PositiveInt,
  title: Schema.String,
  url: Link,
  state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
  draft: Schema.Boolean,
  head: Schema.String,
  base: Schema.String,
  checksCommit: Schema.NullOr(Schema.String),
  checks: Schema.Array(Check),
  reviews: Schema.Array(Review),
  threads: Schema.Array(Thread),
  incomplete: Schema.Boolean,
}).annotate({ identifier: "PullRequest.Snapshot" })
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}

export const Unavailable = Schema.Struct({
  status: Schema.Literal("unavailable"),
  reason: Schema.Literals(["not_git", "detached", "no_pull_request", "authentication", "changed", "request_failed"]),
}).annotate({ identifier: "PullRequest.Unavailable" })
export interface Unavailable extends Schema.Schema.Type<typeof Unavailable> {}

export const Result = Schema.Union([Snapshot, Unavailable]).annotate({ identifier: "PullRequest.Result" })
export type Result = typeof Result.Type

export const Definition = Rpc.define({
  id: "experimental.pull-request",
  methods: {
    get: {
      input: Schema.toStandardSchemaV1(Schema.Struct({})),
      output: Schema.toStandardSchemaV1(Result),
    },
  },
  events: {},
})
