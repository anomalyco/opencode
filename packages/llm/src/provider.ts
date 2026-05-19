import type { RouteModelInput } from "./route/client"
import type { ModelID, ModelRef, ProviderID } from "./schema"

export type ModelOptions = Omit<RouteModelInput, "id">

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

type DefinitionShape = {
  readonly id: ProviderID
  readonly model: (...args: never[]) => ModelRef
  readonly apis?: Record<string, (...args: never[]) => ModelRef>
}

type NoExtraFields<Input, Shape> = Input & Record<Exclude<keyof Input, keyof Shape>, never>

export const make = <DefinitionType extends DefinitionShape>(
  definition: NoExtraFields<DefinitionType, DefinitionShape>,
) => definition

export * as Provider from "./provider"
