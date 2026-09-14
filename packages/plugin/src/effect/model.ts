import type { ModelApi } from "@opencode/client/effect/api"
import type { Model } from "@opencode/schema/model"
import type { Effect, Types } from "effect"
import type { ProviderRecord } from "./provider.js"
import type { Transform } from "./registration.js"

export interface ModelEditor {
  /** Candidates from available providers, including models disabled by earlier transforms. */
  list(providerID?: string): readonly Types.DeepMutable<Model.Info>[]
  get(providerID: string, modelID: string): Types.DeepMutable<Model.Info> | undefined
  /** Edits raw model overrides; cannot create an unavailable provider. */
  update(providerID: string, modelID: string, update: (model: Types.DeepMutable<Model.Info>) => void): void
  remove(providerID: string, modelID: string): void
  readonly default: {
    get(): { providerID: string; modelID: string } | undefined
    set(providerID: string, modelID: string): void
  }
  /** Immutable provider inputs, including inactive templates, before model transforms. */
  readonly provider: {
    list(): readonly ProviderRecord[]
    get(providerID: string): ProviderRecord | undefined
  }
}

export interface ModelDomain extends ModelApi<unknown> {
  readonly transform: Transform<ModelEditor>
  readonly reload: () => Effect.Effect<void>
}
