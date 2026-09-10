import { Question } from "@/question"
import { QuestionID } from "@/question/schema"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { QuestionNotFoundError } from "../errors"
import * as SessionError from "./session-errors"

export const questionHandlers = HttpApiBuilder.group(InstanceHttpApi, "question", (handlers) =>
  Effect.gen(function* () {
    const svc = yield* Question.Service

    const list = Effect.fn("QuestionHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const reply = Effect.fn("QuestionHttpApi.reply")(function* (ctx: {
      params: { requestID: QuestionID }
      payload: Question.Reply
    }) {
      // Refused while the session's branch is being cancelled — an expected outcome of the user's
      // own concurrent stop, reported as a conflict rather than a server defect.
      yield* SessionError.mapAdmission(
        svc
          .reply({
            requestID: ctx.params.requestID,
            answers: ctx.payload.answers,
          })
          .pipe(
            Effect.catchTag("Question.NotFoundError", (error) =>
              Effect.fail(
                new QuestionNotFoundError({
                  requestID: String(error.requestID),
                  message: `Question request not found: ${error.requestID}`,
                }),
              ),
            ),
          ),
      )
      return true
    })

    const reject = Effect.fn("QuestionHttpApi.reject")(function* (ctx: { params: { requestID: QuestionID } }) {
      yield* SessionError.mapAdmission(
        svc.reject(ctx.params.requestID).pipe(
          Effect.catchTag("Question.NotFoundError", (error) =>
            Effect.fail(
              new QuestionNotFoundError({
                requestID: String(error.requestID),
                message: `Question request not found: ${error.requestID}`,
              }),
            ),
          ),
        ),
      )
      return true
    })

    return handlers.handle("list", list).handle("reply", reply).handle("reject", reject)
  }),
)
