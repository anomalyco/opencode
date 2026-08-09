import { Catalog } from "@opencode-ai/core/catalog"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"

export const ModelHandler = HttpApiBuilder.group(Api, "server.model", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle(
      "model.list",
      Effect.fn(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.readiness
        return yield* response(catalog.model.available())
      }),
    )
  }),
)
