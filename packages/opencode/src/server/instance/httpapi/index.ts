import { AppLayer } from "@/effect/app-runtime"
import { memoMap } from "@/effect/run-service"
import { lazy } from "@/util/lazy"
import { Layer } from "effect"
import { Hono } from "hono"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { QuestionApi, QuestionLive } from "./question"

const question = lazy(() =>
  HttpRouter.toWebHandler(
    Layer.mergeAll(
      AppLayer,
      HttpApiBuilder.layer(QuestionApi, { openapiPath: "/experimental/httpapi/question/doc" }).pipe(
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

export const HttpApiRoutes = lazy(() =>
  new Hono()
    .all("/question", (c, _next) => question().handler(c.req.raw))
    .all("/question/*", (c, _next) => question().handler(c.req.raw)),
)
