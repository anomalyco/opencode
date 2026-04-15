import { Effect, Schema } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { QuestionReply, QuestionRequest, questionApi } from "../definition/question.js"

export interface QuestionOps<R = never> {
  readonly list: () => Effect.Effect<ReadonlyArray<unknown>, never, R>
  readonly reply: (input: {
    requestID: string
    answers: Schema.Schema.Type<typeof QuestionReply>["answers"]
  }) => Effect.Effect<void, never, R>
}

export const makeQuestionHandler = <R>(ops: QuestionOps<R>) =>
  HttpApiBuilder.group(
    questionApi,
    "question",
    Effect.fn("QuestionHttpApi.handlers")(function* (handlers) {
      const decode = Schema.decodeUnknownSync(Schema.Array(QuestionRequest))

      const list = Effect.fn("QuestionHttpApi.list")(function* () {
        return decode(yield* ops.list())
      })

      const reply = Effect.fn("QuestionHttpApi.reply")(function* (ctx: {
        params: { requestID: string }
        payload: Schema.Schema.Type<typeof QuestionReply>
      }) {
        yield* ops.reply({
          requestID: ctx.params.requestID,
          answers: ctx.payload.answers,
        })
        return true
      })

      return handlers.handle("list", list).handle("reply", reply)
    }),
  )
