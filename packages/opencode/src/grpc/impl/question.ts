import { create } from "@bufbuild/protobuf"
import { Question } from "../../question"
import {
  QuestionOptionSchema,
  QuestionRequestSchema,
  ListQuestionsResponseSchema,
  ReplyToQuestionResponseSchema,
  RejectQuestionResponseSchema,
  type ListQuestionsRequest,
  type ReplyToQuestionRequest,
  type RejectQuestionRequest,
} from "../gen/opencode/v1/question_pb"

function toProtoQuestionRequest(info: Question.Request) {
  const options = info.questions.flatMap((q) =>
    q.options.map((opt) =>
      create(QuestionOptionSchema, {
        id: opt.label,
        value: opt.description,
      }),
    ),
  )

  return create(QuestionRequestSchema, {
    id: info.id,
    sessionId: info.sessionID,
    title: info.questions[0]?.header || "",
    message: info.questions[0]?.question || "",
    type: info.questions[0]?.multiple ? "multiple" : "single",
    options,
  })
}

export const question = {
  async list(_req: ListQuestionsRequest) {
    const requests = await Question.list()
    return create(ListQuestionsResponseSchema, {
      questions: requests.map(toProtoQuestionRequest),
    })
  },

  async reply(req: ReplyToQuestionRequest) {
    await Question.reply({
      requestID: req.requestId,
      answers: [req.answers],
    })
    return create(ReplyToQuestionResponseSchema, { success: true })
  },

  async reject(req: RejectQuestionRequest) {
    await Question.reject(req.requestId)
    return create(RejectQuestionResponseSchema, { success: true })
  },
}
