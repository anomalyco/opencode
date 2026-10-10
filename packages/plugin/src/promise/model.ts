import type { ModelApi } from "@opencode/client/promise/api"
import type { Model } from "@opencode/schema/model"
import type { ProviderRecord } from "./provider.js"
import type { Transform } from "./registration.js"
import type { DeepMutable } from "./types.js"

export interface ModelEditor {
  /** Candidates from available providers, including models disabled by earlier transforms. */
  list(providerID?: string): readonly DeepMutable<Model.Info>[]
  get(providerID: string, modelID: string): DeepMutable<Model.Info> | undefined
  /** Edits raw model overrides; cannot create an unavailable provider. */
  update(providerID: string, modelID: string, update: (model: DeepMutable<Model.Info>) => void): void
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

// `refresh` is a server/CLI concern (force a models.dev cache update) and is not
// exposed through the plugin model domain, so hosts are not required to provide it.
export interface ModelDomain extends Omit<ModelApi, "refresh"> {
  readonly transform: Transform<ModelEditor>
  readonly reload: () => Promise<void>
}
