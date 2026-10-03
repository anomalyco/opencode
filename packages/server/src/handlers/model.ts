import { Catalog } from "@opencode-ai/core/catalog"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { response } from "../location"

export const ModelHandler = HttpApiBuilder.group(Api, "server.model", (handlers) =>
  Effect.gen(function* () {
    const awaitCatalog = Effect.fn(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.ready.pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () =>
            Effect.fail(
              new ServiceUnavailableError({
                message: "Model catalog initialization timed out",
                service: "model.catalog",
              }),
            ),
        }),
      )
      return catalog
    })

    return handlers.handle(
      "model.list",
      Effect.fn(function* () {
        const catalog = yield* awaitCatalog()
        return yield* response(catalog.model.available())
      }),
    )
  }),
)

