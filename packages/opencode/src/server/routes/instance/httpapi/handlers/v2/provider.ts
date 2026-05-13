import { Catalog } from "@opencode-ai/core/catalog"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../api"
import { notFound } from "../../errors"

export const providerHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.provider", (handlers) =>
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service

    return handlers
      .handle("providers", () => catalog.provider.available())
      .handle(
        "provider",
        Effect.fn(function* (ctx) {
          return yield* catalog.provider
            .get(ctx.params.providerID)
            .pipe(Effect.catchTag("CatalogV2.ProviderNotFound", () => Effect.fail(notFound("Provider not found"))))
        }),
      )
  }),
)
