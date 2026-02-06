import type { ForkProviderConfig, ProviderInfo, ProviderModel } from "./types"
import { augmentOpenRouterModels, getOpenRouterPreferredModels } from "./openrouter"

export function augmentForkProviders(params: {
  providers: Record<string, ProviderInfo>
  config: ForkProviderConfig
}): void {
  const openrouterProvider = params.providers["openrouter"]
  if (!openrouterProvider) return

  augmentOpenRouterModels(openrouterProvider, params.config.openrouter)
}

export function getForkPreferredModels(params: {
  provider: ProviderInfo
  models: ProviderModel[]
  config: ForkProviderConfig
}): ProviderModel[] | undefined {
  return getOpenRouterPreferredModels(params.provider)
}
