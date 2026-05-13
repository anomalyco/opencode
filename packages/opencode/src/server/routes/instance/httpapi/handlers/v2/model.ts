import { Catalog } from "@opencode-ai/core/catalog"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../../api"

export const modelHandlers = HttpApiBuilder.group(InstanceHttpApi, "v2.model", (handlers) =>
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service

    return handlers.handle("models", () => catalog.model.available())
  }),
)
