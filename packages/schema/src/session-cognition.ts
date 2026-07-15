export * as SessionCognition from "./session-cognition"

import { Schema } from "effect"
import { optional } from "./schema"
import { FileAttachment } from "./prompt"
import { SessionID } from "./session-id"

export namespace Plan {
  export const File = Schema.Struct({
    path: Schema.String,
    relevance: Schema.String,
  }).annotate({ identifier: "Session.Cognition.Plan.File" })
  export type File = typeof File.Type

  export const Risk = Schema.Struct({
    description: Schema.String,
    severity: Schema.Literals(["low", "medium", "high"]),
  }).annotate({ identifier: "Session.Cognition.Plan.Risk" })
  export type Risk = typeof Risk.Type

  export const Approach = Schema.Struct({
    step: Schema.Number,
    description: Schema.String,
  }).annotate({ identifier: "Session.Cognition.Plan.Approach" })
  export type Approach = typeof Approach.Type

  export const Info = Schema.Struct({
    intent: Schema.String,
    affectedFiles: Schema.Array(File),
    risks: Schema.Array(Risk),
    approach: Schema.Array(Approach),
    missingContext: Schema.Array(Schema.String).pipe(optional),
    attachments: Schema.Array(FileAttachment).pipe(optional),
  }).annotate({ identifier: "Session.Cognition.Plan" })
  export type Info = typeof Info.Type

  export const Input = Schema.Struct({
    sessionID: SessionID,
    latestUserMessage: Schema.String,
    projectContext: Schema.String.pipe(optional),
    recentFileChanges: Schema.Array(Schema.String).pipe(optional),
  }).annotate({ identifier: "Session.Cognition.Plan.Input" })
  export type Input = typeof Input.Type
}

export namespace Verify {
  export const Issue = Schema.Struct({
    type: Schema.Literals(["type-error", "logic-error", "missing-test", "side-effect", "convention-violation", "other"]),
    description: Schema.String,
    file: Schema.String.pipe(optional),
    severity: Schema.Literals(["suggestion", "warning", "error"]),
  }).annotate({ identifier: "Session.Cognition.Verify.Issue" })
  export type Issue = typeof Issue.Type

  export const Info = Schema.Struct({
    passed: Schema.Boolean,
    issues: Schema.Array(Issue),
    summary: Schema.String,
    suggestions: Schema.Array(Schema.String).pipe(optional),
  }).annotate({ identifier: "Session.Cognition.Verify" })
  export type Info = typeof Info.Type

  export const Input = Schema.Struct({
    sessionID: SessionID,
    changes: Schema.Array(Schema.String),
    finishReason: Schema.String,
    testResults: Schema.String.pipe(optional),
  }).annotate({ identifier: "Session.Cognition.Verify.Input" })
  export type Input = typeof Input.Type
}

export namespace Reflect {
  export const Insight = Schema.Struct({
    type: Schema.Literals(["architecture", "pattern", "constraint", "decision", "user-preference"]),
    content: Schema.String,
    context: Schema.String.pipe(optional),
  }).annotate({ identifier: "Session.Cognition.Reflect.Insight" })
  export type Insight = typeof Insight.Type

  export const Info = Schema.Struct({
    insights: Schema.Array(Insight),
    summary: Schema.String,
  }).annotate({ identifier: "Session.Cognition.Reflect" })
  export type Info = typeof Info.Type

  export const Input = Schema.Struct({
    sessionID: SessionID,
    completedSteps: Schema.Number,
    errors: Schema.Array(Schema.String).pipe(optional),
    changedFiles: Schema.Array(Schema.String).pipe(optional),
  }).annotate({ identifier: "Session.Cognition.Reflect.Input" })
  export type Input = typeof Input.Type
}
