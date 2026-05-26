import type { RouteDefaultsInput } from "./route/client"
import type { Model, ModelID, ProviderID } from "./schema"

export type ModelOptions = RouteDefaultsInput

/**
 * Advanced structural provider definition helper. Built-in providers should
 * prefer explicit `configure(options).model(id)` facades so deployment config is
 * chosen before model selection. The optional `apis` map remains for external
 * structural providers that expose multiple route selectors behind one provider.
 */
export type ModelFactory<Options extends ModelOptions = ModelOptions> = (
  id: string | ModelID,
  options?: Options,
) => Model

type AnyModelFactory = (...args: never[]) => Model

export interface Definition<Factory extends AnyModelFactory = ModelFactory> {
  readonly id: ProviderID
  readonly model: Factory
  readonly apis?: Record<string, AnyModelFactory>
}

type DefinitionShape = {
  readonly id: ProviderID
  readonly model: (...args: never[]) => Model
  readonly apis?: Record<string, (...args: never[]) => Model>
}

type NoExtraFields<Input, Shape> = Input & Record<Exclude<keyof Input, keyof Shape>, never>

export const make = <DefinitionType extends DefinitionShape>(
  definition: NoExtraFields<DefinitionType, DefinitionShape>,
) => definition

export * as Provider from "./provider"
