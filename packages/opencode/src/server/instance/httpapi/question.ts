import { AppLayer } from "@/effect/app-runtime"
import { memoMap } from "@/effect/run-service"
import { Question } from "@/question"
import { QuestionID } from "@/question/schema"
import { lazy } from "@/util/lazy"
import { makeQuestionHandler, questionApi } from "@opencode-ai/server"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import type { Handler } from "hono"

const root = "/experimental/httpapi/question"

const QuestionLive = makeQuestionHandler({
  list: Effect.fn("QuestionHttpApi.host.list")(function* () {
    const svc = yield* Question.Service
    return yield* svc.list()
  }),
  reply: Effect.fn("QuestionHttpApi.host.reply")(function* (input) {
    const svc = yield* Question.Service
    yield* svc.reply({
      requestID: QuestionID.make(input.requestID),
      answers: input.answers,
    })
  }),
}).pipe(Layer.provide(Question.defaultLayer))

const web = lazy(() =>
  HttpRouter.toWebHandler(
    Layer.mergeAll(
      AppLayer,
      HttpApiBuilder.layer(questionApi, { openapiPath: `${root}/doc` }).pipe(
        Layer.provide(QuestionLive),
        Layer.provide(HttpServer.layerServices),
      ),
    ),
    {
      disableLogger: true,
      memoMap,
    },
  ),
)

export const QuestionHttpApiHandler: Handler = (c, _next) => web().handler(c.req.raw)
