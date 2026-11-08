export * as Github from "./github.js"

import { Schema } from "effect"
import { statics } from "./schema.js"

export const PRReference = Schema.Struct({
  owner: Schema.Trim.pipe(Schema.check(Schema.isNonEmpty())).annotate({ description: "Repository owner (user or organization)." }),
  repo: Schema.Trim.pipe(Schema.check(Schema.isNonEmpty())).annotate({ description: "Repository name." }),
  number: Schema.Int.check(Schema.isGreaterThan(0)).annotate({ description: "PR number." }),
}).annotate({ identifier: "Github.PRReference" })
export interface PRReference extends Schema.Schema.Type<typeof PRReference> {}

export const PRReferenceStatics = statics((schema) => ({
  parse: (owner: string, repo: string, number: number) =>
    ({ owner: owner.trim(), repo: repo.trim(), number } as PRReference),
}))(PRReference)

export const PRInfo = Schema.Struct({
  url: Schema.String,
  html_url: Schema.String,
  title: Schema.String,
  state: Schema.Literals(["open", "closed", "merged"]),
  merged: Schema.Boolean,
  additions: Schema.Number,
  deletions: Schema.Number,
  changed_files: Schema.Number,
  comments: Schema.Number,
  review_comments: Schema.Number,
  commits: Schema.Number,
  number: Schema.Number,
  head: Schema.Struct({
    ref: Schema.String,
    sha: Schema.String,
    label: Schema.String.pipe(Schema.optional),
    repo: Schema.Struct({
      owner: Schema.String,
      name: Schema.String,
      full_name: Schema.String,
      private: Schema.Boolean,
    }),
  }),
  base: Schema.Struct({
    ref: Schema.String,
    sha: Schema.String,
    label: Schema.String.pipe(Schema.optional),
    repo: Schema.Struct({
      owner: Schema.String,
      name: Schema.String,
      full_name: Schema.String,
      private: Schema.Boolean,
    }),
  }),
  created_at: Schema.String,
  updated_at: Schema.String,
  closed_at: Schema.String.pipe(Schema.optional),
  merged_at: Schema.String.pipe(Schema.optional),
  draft: Schema.Boolean,
}).annotate({ identifier: "Github.PRInfo" })
export interface PRInfo extends Schema.Schema.Type<typeof PRInfo> {}
