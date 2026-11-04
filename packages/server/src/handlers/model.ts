import { Model } from "@opencode/core/model"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { awaitPlugins, response } from "../location"

export const ModelHandler = HttpApiBuilder.group(Api, "server.model", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "model.list",
        Effect.fn(function* (ctx) {
          yield* awaitPlugins
          const models = yield* Model.Service
          return yield* response(models.available(ctx.query.types))
        }),
      )
      .handle(
        "model.default",
        Effect.fn(function* () {
          yield* awaitPlugins
          const models = yield* Model.Service
          return yield* response(models.default())
        }),
      )
  }),
)
