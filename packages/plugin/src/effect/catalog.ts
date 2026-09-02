import type { CatalogApi } from "@opencode-ai/client/effect/api"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import type { Effect, Types } from "effect"
import type { Transform } from "./registration.js"

export interface CatalogProviderRecord {
  readonly provider: Types.DeepMutable<Provider.Info>
  readonly models: ReadonlyMap<string, Types.DeepMutable<Model.Info>>
}

export interface CatalogEditor {
  readonly provider: {
    list(): readonly CatalogProviderRecord[]
    get(providerID: string): CatalogProviderRecord | undefined
    update(providerID: string, update: (provider: Types.DeepMutable<Provider.Info>) => void): void
    remove(providerID: string): void
  }
  readonly model: {
    get(providerID: string, modelID: string): Types.DeepMutable<Model.Info> | undefined
    update(providerID: string, modelID: string, update: (model: Types.DeepMutable<Model.Info>) => void): void
    remove(providerID: string, modelID: string): void
    readonly default: {
      get(): { providerID: string; modelID: string } | undefined
      set(providerID: string, modelID: string): void
    }
  }
}

export interface CatalogDomain extends CatalogApi<unknown> {
  readonly transform: Transform<CatalogEditor>
  readonly reload: () => Effect.Effect<void>
}
