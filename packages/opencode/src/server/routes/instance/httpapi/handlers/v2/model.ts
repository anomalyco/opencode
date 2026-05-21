import { Catalog } from "@opencode-ai/core/catalog"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../api"
import { ServiceUnavailableError } from "../../errors"

const catalogUnavailable = new ServiceUnavailableError({
  message: "Model catalog is unavailable",
  service: "catalog",
})

export const modelHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.model", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle(
      "models",
      Effect.fn(function* () {
        const catalog = yield* Catalog.Service
        const pluginBoot = yield* PluginBoot.Service
        yield* pluginBoot.wait().pipe(Effect.catchDefect(() => Effect.fail(catalogUnavailable)))
        return yield* catalog.model.available()
      }),
    )
  }),
)
