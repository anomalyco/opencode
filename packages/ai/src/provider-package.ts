import type { Model, ProviderOptions } from "./schema"

export interface Settings extends Readonly<Record<string, unknown>> {
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Readonly<Record<string, unknown>>
  readonly limits?: {
    readonly context: number
    readonly output: number
  }
}

export interface Definition<
  ProviderSettings extends Settings = Settings,
  Options extends ProviderOptions = ProviderOptions,
> {
  readonly model: (modelID: string, settings: ProviderSettings) => Model<Options>
}

export * as ProviderPackage from "./provider-package"
