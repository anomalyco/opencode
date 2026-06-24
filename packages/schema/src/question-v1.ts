export * as QuestionV1 from "./question-v1"

import { Schema } from "effect"
import { define } from "./event"
import { ascending } from "./identifier"
import { withStatics } from "./schema"
import { Session } from "./session"
import { SessionV1 } from "./session-v1"

export const ID = Schema.String.check(Schema.isStartsWith("que")).pipe(
  Schema.brand("QuestionID"),
  withStatics((schema) => ({ ascending: (id?: string) => schema.make(id ?? "que_" + ascending()) })),
)

export const Option = Schema.Struct({
  label: Schema.String.annotate({ description: "Display text (1-5 words, concise)" }),
  description: Schema.String.annotate({ description: "Explanation of choice" }),
}).annotate({ identifier: "QuestionOption" })

const base = {
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  options: Schema.Array(Option).annotate({ description: "Available choices" }),
  multiple: Schema.optional(Schema.Boolean).annotate({ description: "Allow selecting multiple choices" }),
}

export const Info = Schema.Struct({
  ...base,
  custom: Schema.optional(Schema.Boolean).annotate({ description: "Allow typing a custom answer (default: true)" }),
}).annotate({ identifier: "QuestionInfo" })
export const Prompt = Schema.Struct(base).annotate({ identifier: "QuestionPrompt" })
export const Tool = Schema.Struct({ messageID: SessionV1.MessageID, callID: Schema.String }).annotate({
  identifier: "QuestionTool",
})
export const Request = Schema.Struct({
  id: ID,
  sessionID: Session.ID,
  questions: Schema.Array(Info).annotate({ description: "Questions to ask" }),
  tool: Schema.optional(Tool),
}).annotate({ identifier: "QuestionRequest" })
export const Answer = Schema.Array(Schema.String).annotate({ identifier: "QuestionAnswer" })
export const Reply = Schema.Struct({
  answers: Schema.Array(Answer).annotate({
    description: "User answers in order of questions (each answer is an array of selected labels)",
  }),
}).annotate({ identifier: "QuestionReply" })
export const Replied = Schema.Struct({ sessionID: Session.ID, requestID: ID, answers: Schema.Array(Answer) }).annotate({
  identifier: "QuestionReplied",
})
export const Rejected = Schema.Struct({ sessionID: Session.ID, requestID: ID }).annotate({
  identifier: "QuestionRejected",
})

export const Event = {
  Asked: define({ type: "question.asked", schema: Request.fields }),
  Replied: define({ type: "question.replied", schema: Replied.fields }),
  Rejected: define({ type: "question.rejected", schema: Rejected.fields }),
}
