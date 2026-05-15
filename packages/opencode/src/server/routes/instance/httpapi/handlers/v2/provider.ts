import { Catalog } from "@opencode-ai/core/catalog"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../api"
import { notFound } from "../../errors"

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.provider", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "providers",
        Effect.fn(function* () {
          const catalog = yield* Catalog.Service
          const pluginBoot = yield* PluginBoot.Service
          yield* pluginBoot.wait()
          return yield* catalog.provider.available()
        }),
      )
      .handle(
        "provider",
        Effect.fn(function* (ctx) {
          const catalog = yield* Catalog.Service
          const pluginBoot = yield* PluginBoot.Service
          yield* pluginBoot.wait()
          return yield* catalog.provider
            .get(ctx.params.providerID)
            .pipe(Effect.catchTag("CatalogV2.ProviderNotFound", () => Effect.fail(notFound("Provider not found"))))
        }),
      )
  }),
)
