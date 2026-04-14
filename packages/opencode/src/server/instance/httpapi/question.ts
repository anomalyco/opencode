import { AppLayer } from "@/effect/app-runtime"
import { memoMap } from "@/effect/run-service"
import { Question } from "@/question"
import { QuestionID } from "@/question/schema"
import { lazy } from "@/util/lazy"
import { QuestionReply, QuestionRequest, questionApi } from "@opencode-ai/server"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import type { Handler } from "hono"

const root = "/experimental/httpapi/question"

const QuestionLive = HttpApiBuilder.group(
  questionApi,
  "question",
  Effect.fn("QuestionHttpApi.handlers")(function* (handlers) {
    const svc = yield* Question.Service
    const decode = Schema.decodeUnknownSync(Schema.Array(QuestionRequest))

    const list = Effect.fn("QuestionHttpApi.list")(function* () {
      return decode(yield* svc.list())
    })

    const reply = Effect.fn("QuestionHttpApi.reply")(function* (ctx: {
      params: { requestID: string }
      payload: Schema.Schema.Type<typeof QuestionReply>
    }) {
      yield* svc.reply({
        requestID: QuestionID.make(ctx.params.requestID),
        answers: ctx.payload.answers,
      })
      return true
    })

    return handlers.handle("list", list).handle("reply", reply)
  }),
).pipe(Layer.provide(Question.defaultLayer))

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
