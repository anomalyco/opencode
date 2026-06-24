export * as Question from "./question"

import { Schema } from "effect"
import { define } from "./event"
import { ascending } from "./identifier"
import { SessionID } from "./session-id"
import { withStatics } from "./schema"

export const ID = Schema.String.check(Schema.isStartsWith("que")).pipe(
  Schema.brand("QuestionV2.ID"),
  withStatics((schema) => ({ ascending: (id?: string) => schema.make(id ?? "que_" + ascending()) })),
)
export type ID = typeof ID.Type

export const Option = Schema.Struct({
  label: Schema.String.annotate({ description: "Display text (1-5 words, concise)" }),
  description: Schema.String.annotate({ description: "Explanation of choice" }),
}).annotate({ identifier: "QuestionV2.Option" })
export type Option = typeof Option.Type

const base = {
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  options: Schema.Array(Option).annotate({ description: "Available choices" }),
  multiple: Schema.Boolean.pipe(Schema.optional).annotate({ description: "Allow selecting multiple choices" }),
}

export const Info = Schema.Struct({
  ...base,
  custom: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Allow typing a custom answer (default: true)",
  }),
}).annotate({ identifier: "QuestionV2.Info" })
export type Info = typeof Info.Type

export const Prompt = Schema.Struct(base).annotate({ identifier: "QuestionV2.Prompt" })
export type Prompt = typeof Prompt.Type

export const Tool = Schema.Struct({
  messageID: Schema.String,
  callID: Schema.String,
}).annotate({ identifier: "QuestionV2.Tool" })
export type Tool = typeof Tool.Type

export const Request = Schema.Struct({
  id: ID,
  sessionID: SessionID.ID,
  questions: Schema.Array(Info).annotate({ description: "Questions to ask" }),
  tool: Tool.pipe(Schema.optional),
}).annotate({ identifier: "QuestionV2.Request" })
export type Request = typeof Request.Type

export const Answer = Schema.Array(Schema.String).annotate({ identifier: "QuestionV2.Answer" })
export type Answer = typeof Answer.Type

export const Reply = Schema.Struct({
  answers: Schema.Array(Answer).annotate({
    description: "User answers in order of questions (each answer is an array of selected labels)",
  }),
}).annotate({ identifier: "QuestionV2.Reply" })
export type Reply = typeof Reply.Type

export const Event = {
  Asked: define({ type: "question.v2.asked", schema: Request.fields }),
  Replied: define({
    type: "question.v2.replied",
    schema: {
      sessionID: SessionID.ID,
      requestID: ID,
      answers: Schema.Array(Answer),
    },
  }),
  Rejected: define({
    type: "question.v2.rejected",
    schema: {
      sessionID: SessionID.ID,
      requestID: ID,
    },
  }),
}
