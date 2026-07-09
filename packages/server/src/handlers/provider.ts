import { Catalog } from "@opencode-ai/core/catalog"
import { PluginSupervisor } from "@opencode-ai/core/plugin/supervisor"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ProviderNotFoundError, ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { response } from "../location"

export const ProviderHandler = HttpApiBuilder.group(Api, "server.provider", (handlers) =>
  Effect.gen(function* () {
    const plugins = yield* PluginSupervisor.Service
    const awaitCatalog = Effect.fn(function* () {
      yield* plugins.flush.pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () =>
            Effect.fail(
              new ServiceUnavailableError({
                message: "Provider catalog initialization timed out",
                service: "provider.catalog",
              }),
            ),
        }),
      )
    })

    return handlers
      .handle(
        "provider.list",
        Effect.fn(function* () {
          yield* awaitCatalog()
          const catalog = yield* Catalog.Service
          return yield* response(catalog.provider.available())
        }),
      )
      .handle(
        "provider.get",
        Effect.fn(function* (ctx) {
          yield* awaitCatalog()
          const catalog = yield* Catalog.Service
          const provider = yield* catalog.provider.get(ctx.params.providerID)
          if (!provider)
            return yield* new ProviderNotFoundError({
              providerID: ctx.params.providerID,
              message: `Provider not found: ${ctx.params.providerID}`,
            })
          return yield* response(Effect.succeed(provider))
        }),
      )
  }),
)
