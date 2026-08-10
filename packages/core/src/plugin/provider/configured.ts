import { Effect, Option } from "effect"
import type { Document } from "@opencode-ai/schema/config"
import { Catalog } from "../../catalog"
import { Config } from "../../config"
import { Provider } from "../../provider"

export const configuredSettings = Effect.fn("ProviderPlugin.configuredSettings")(function* (id: Provider.ID) {
  const catalog = yield* Catalog.Service
  const current = (yield* catalog.provider.get(id))?.settings
  const service = yield* Effect.serviceOption(Config.Service)
  const entries = Option.isSome(service) ? yield* service.value.entries() : []
  return entries
    .filter((entry): entry is Document => entry.type === "document")
    .reduce((settings, entry) => Provider.mergeOverlay(settings, entry.info.providers?.[id]?.settings), current)
})
