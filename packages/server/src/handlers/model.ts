import { Model } from "@opencode/core/model"
import { ModelsDev } from "@opencode/core/models-dev"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { awaitPlugins, response } from "../location"

export const ModelHandler = HttpApiBuilder.group(Api, "server.model", (handlers) =>
  Effect.gen(function* () {
    const modelsDev = yield* ModelsDev.Service
    return handlers
      .handle(
        "model.list",
        Effect.fn(function* () {
          yield* awaitPlugins
          const models = yield* Model.Service
          return yield* response(models.available())
        }),
      )
      .handle(
        "model.refresh",
        Effect.fn(function* () {
          yield* modelsDev.refresh(true)
          yield* awaitPlugins
          const models = yield* Model.Service
          return yield* response(models.available())
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
