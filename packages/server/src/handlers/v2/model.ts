import { Catalog } from "@opencode-ai/core/catalog"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { V2Api } from "../../api"
import { ServiceUnavailableError } from "../../errors"
import { response } from "../../groups/v2/location"

const catalogUnavailable = new ServiceUnavailableError({
  message: "Model catalog is unavailable",
  service: "catalog",
})

export const modelHandlers = HttpApiBuilder.group(V2Api, "v2.model", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle(
      "models",
      Effect.fn(function* () {
        const catalog = yield* Catalog.Service
        const pluginBoot = yield* PluginBoot.Service
        yield* pluginBoot.wait().pipe(Effect.catchDefect(() => Effect.fail(catalogUnavailable)))
        return yield* response(catalog.model.available())
      }),
    )
  }),
)
