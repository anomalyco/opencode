import { Catalog } from "@opencode-ai/core/catalog"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ProviderNotFoundError, ServiceUnavailableError } from "../errors"
import { response } from "../groups/location"

const catalogUnavailable = new ServiceUnavailableError({
  message: "Provider catalog is unavailable",
  service: "catalog",
})

export const ProviderHandler = HttpApiBuilder.group(Api, "server.provider", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "provider.list",
        Effect.fn(function* () {
          const catalog = yield* Catalog.Service
          const pluginBoot = yield* PluginBoot.Service
          yield* pluginBoot.wait().pipe(Effect.catchDefect(() => Effect.fail(catalogUnavailable)))
          return yield* response(catalog.provider.available())
        }),
      )
      .handle(
        "provider.get",
        Effect.fn(function* (ctx) {
          const catalog = yield* Catalog.Service
          const pluginBoot = yield* PluginBoot.Service
          yield* pluginBoot.wait().pipe(Effect.catchDefect(() => Effect.fail(catalogUnavailable)))
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
