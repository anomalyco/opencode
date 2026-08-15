import { Catalog } from "@opencode-ai/core/catalog"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { Duration, Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { response } from "../location"

/** Cold starts must not serve a partially populated catalog as authoritative state. */
const awaitCatalogReadiness: Effect.Effect<void, ServiceUnavailableError, PluginV2.Service> = Effect.gen(function* () {
  yield* (yield* PluginV2.Service).flush().pipe(
    Effect.timeout(Duration.seconds(10)),
    Effect.catchTag("TimeoutError", () =>
      new ServiceUnavailableError({ message: "Catalog is still initializing", service: "catalog" }),
    ),
  )
})

export const ModelHandler = HttpApiBuilder.group(Api, "server.model", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle(
      "model.list",
      Effect.fn(function* () {
        const catalog = yield* Catalog.Service
        yield* awaitCatalogReadiness
        return yield* response(catalog.model.available())
      }),
    )
  }),
)
