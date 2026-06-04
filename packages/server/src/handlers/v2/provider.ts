import { Catalog } from "@opencode-ai/core/catalog"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { V2Api } from "../../api"
import { ProviderNotFoundError, ServiceUnavailableError } from "../../errors"
import { response } from "../../groups/v2/location"

const catalogUnavailable = new ServiceUnavailableError({
  message: "Provider catalog is unavailable",
  service: "catalog",
})

export const providerHandlers = HttpApiBuilder.group(V2Api, "v2.provider", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "providers",
        Effect.fn(function* () {
          const catalog = yield* Catalog.Service
          const pluginBoot = yield* PluginBoot.Service
          yield* pluginBoot.wait().pipe(Effect.catchDefect(() => Effect.fail(catalogUnavailable)))
          return yield* response(catalog.provider.available())
        }),
      )
      .handle(
        "provider",
        Effect.fn(function* (ctx) {
          const catalog = yield* Catalog.Service
          const pluginBoot = yield* PluginBoot.Service
          yield* pluginBoot.wait().pipe(Effect.catchDefect(() => Effect.fail(catalogUnavailable)))
          return yield* response(catalog.provider.get(ctx.params.providerID)).pipe(
            Effect.catchTag("CatalogV2.ProviderNotFound", (error) =>
              Effect.fail(
                new ProviderNotFoundError({
                  providerID: error.providerID,
                  message: `Provider not found: ${error.providerID}`,
                }),
              ),
            ),
          )
        }),
      )
  }),
)
