import type { CatalogApi } from "@opencode-ai/client/promise/api"
import type { Model } from "@opencode-ai/schema/model"
import type { Provider } from "@opencode-ai/schema/provider"
import type { Transform } from "./registration.js"
import type { DeepMutable } from "./types.js"

export interface CatalogProviderRecord {
  readonly provider: DeepMutable<Provider.Info>
  readonly models: ReadonlyMap<string, DeepMutable<Model.Info>>
}

export interface CatalogEditor {
  readonly provider: {
    list(): readonly CatalogProviderRecord[]
    get(providerID: string): CatalogProviderRecord | undefined
    update(providerID: string, update: (provider: DeepMutable<Provider.Info>) => void): void
    remove(providerID: string): void
  }
  readonly model: {
    get(providerID: string, modelID: string): DeepMutable<Model.Info> | undefined
    update(providerID: string, modelID: string, update: (model: DeepMutable<Model.Info>) => void): void
    remove(providerID: string, modelID: string): void
    readonly default: {
      get(): { providerID: string; modelID: string } | undefined
      set(providerID: string, modelID: string): void
    }
  }
}

export interface CatalogDomain extends CatalogApi {
  readonly transform: Transform<CatalogEditor>
  readonly reload: () => Promise<void>
}
