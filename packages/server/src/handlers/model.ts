import { Catalog } from "@opencode-ai/core/catalog"
import { ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"
import { pluginReadiness } from "./plugin-readiness"

const flushPlugins = pluginReadiness(
  () =>
    new ServiceUnavailableError({
      message: "Model catalog initialization timed out",
      service: "model.catalog",
    }),
)

export const ModelHandler = HttpApiBuilder.group(Api, "server.model", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "model.list",
        Effect.fn(function* () {
          yield* flushPlugins
          const catalog = yield* Catalog.Service
          return yield* response(catalog.model.available())
        }),
      )
      .handle(
        "model.default",
        Effect.fn(function* () {
          yield* flushPlugins
          const catalog = yield* Catalog.Service
          return yield* response(catalog.model.default())
        }),
      )
  }),
)
