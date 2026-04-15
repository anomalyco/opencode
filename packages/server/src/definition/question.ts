import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const root = "/experimental/httpapi/question"

// Temporary transport-local schemas until canonical question schemas move into packages/core.
export const QuestionID = Schema.String.annotate({ identifier: "QuestionID" })
export const SessionID = Schema.String.annotate({ identifier: "SessionID" })
export const MessageID = Schema.String.annotate({ identifier: "MessageID" })

export class QuestionOption extends Schema.Class<QuestionOption>("QuestionOption")({
  label: Schema.String.annotate({
    description: "Display text (1-5 words, concise)",
  }),
  description: Schema.String.annotate({
    description: "Explanation of choice",
  }),
}) {}

const base = {
  question: Schema.String.annotate({
    description: "Complete question",
  }),
  header: Schema.String.annotate({
    description: "Very short label (max 30 chars)",
  }),
  options: Schema.Array(QuestionOption).annotate({
    description: "Available choices",
  }),
  multiple: Schema.optional(Schema.Boolean).annotate({
    description: "Allow selecting multiple choices",
  }),
}

export class QuestionInfo extends Schema.Class<QuestionInfo>("QuestionInfo")({
  ...base,
  custom: Schema.optional(Schema.Boolean).annotate({
    description: "Allow typing a custom answer (default: true)",
  }),
}) {}

export class QuestionTool extends Schema.Class<QuestionTool>("QuestionTool")({
  messageID: MessageID,
  callID: Schema.String,
}) {}

export class QuestionRequest extends Schema.Class<QuestionRequest>("QuestionRequest")({
  id: QuestionID,
  sessionID: SessionID,
  questions: Schema.Array(QuestionInfo).annotate({
    description: "Questions to ask",
  }),
  tool: Schema.optional(QuestionTool),
}) {}

export const QuestionAnswer = Schema.Array(Schema.String).annotate({ identifier: "QuestionAnswer" })

export class QuestionReply extends Schema.Class<QuestionReply>("QuestionReply")({
  answers: Schema.Array(QuestionAnswer).annotate({
    description: "User answers in order of questions (each answer is an array of selected labels)",
  }),
}) {}

export const questionApi = HttpApi.make("question").add(
  HttpApiGroup.make("question")
    .add(
      HttpApiEndpoint.get("list", root, {
        success: Schema.Array(QuestionRequest),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "question.list",
          summary: "List pending questions",
          description: "Get all pending question requests across all sessions.",
        }),
      ),
      HttpApiEndpoint.post("reply", `${root}/:requestID/reply`, {
        params: { requestID: QuestionID },
        payload: QuestionReply,
        success: Schema.Boolean,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "question.reply",
          summary: "Reply to question request",
          description: "Provide answers to a question request from the AI assistant.",
        }),
      ),
    )
    .annotateMerge(
      OpenApi.annotations({
        title: "question",
        description: "Experimental HttpApi question routes.",
      }),
    ),
)
