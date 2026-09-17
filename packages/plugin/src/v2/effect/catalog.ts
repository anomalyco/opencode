import type { ModelV2Info, ProviderV2Info } from "@opencode-ai/sdk/v2/types"
import type { Hooks } from "./registration.js"

export interface CatalogProviderRecord {
  readonly provider: ProviderV2Info
  readonly models: ReadonlyMap<string, ModelV2Info>
}

export interface CatalogDraft {
  readonly provider: {
    list(): readonly CatalogProviderRecord[]
    get(providerID: string): CatalogProviderRecord | undefined
    update(providerID: string, update: (provider: ProviderV2Info) => void): void
    remove(providerID: string): void
  }
  readonly model: {
    get(providerID: string, modelID: string): ModelV2Info | undefined
    update(providerID: string, modelID: string, update: (model: ModelV2Info) => void): void
    remove(providerID: string, modelID: string): void
    readonly default: {
      get(): { providerID: string; modelID: string } | undefined
      set(providerID: string, modelID: string): void
    }
  }
}

export type CatalogHooks = Hooks<{
  transform: CatalogDraft
}>
