import type { AdapterModelInput } from "./adapter/client"
import type { ModelID, ModelRef, ProviderID } from "./schema"

export type ModelOptions = Omit<AdapterModelInput, "id">

export type ModelFactory<Options extends ModelOptions = ModelOptions> = (
  id: string | ModelID,
  options?: Options,
) => ModelRef

type AnyModelFactory = (...args: never[]) => ModelRef

export interface Definition<Factory extends AnyModelFactory = ModelFactory> {
  readonly id: ProviderID
  readonly model: Factory
  readonly apis?: Record<string, AnyModelFactory>
}

export const make = <DefinitionType extends {
  readonly id: ProviderID
  readonly model: (...args: never[]) => ModelRef
  readonly apis?: Record<string, (...args: never[]) => ModelRef>
}>(definition: DefinitionType) => definition

export * as Provider from "./provider"
