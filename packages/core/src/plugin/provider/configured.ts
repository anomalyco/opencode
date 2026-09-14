import { Effect, Option } from "effect"
import type { Document, Entry } from "@opencode/schema/config"
import { Config } from "../../config.js"
import { Provider } from "../../provider.js"

export const configuredSettings = Effect.fn("ProviderPlugin.configuredSettings")(function* (id: Provider.ID) {
  const providers = yield* Provider.Service
  const current = (yield* providers.get(id))?.settings
  const service = yield* Effect.serviceOption(Config.Service)
  const entries = Option.isSome(service) ? yield* service.value.entries() : []
  return foldSettings(entries, id, current)
})

export function foldSettings(entries: readonly Entry[], id: string, initial: Provider.Settings | undefined) {
  return entries
    .filter((entry): entry is Document => entry.type === "document")
    .reduce((settings, entry) => Provider.mergeOverlay(settings, entry.info.providers?.[id]?.settings), initial)
}
