import type { LanguageModel, ProviderOptions } from "./schema/index.js"

export interface Settings extends Readonly<Record<string, unknown>> {
  readonly baseURL?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Readonly<Record<string, unknown>>
  readonly limits?: {
    readonly context: number
    readonly input?: number
    readonly output: number
  }
}

export interface Definition<
  ProviderSettings extends Settings = Settings,
  Options extends ProviderOptions = ProviderOptions,
> {
  readonly model: (modelID: string, settings: ProviderSettings) => LanguageModel<Options>
}

export * as ProviderPackage from "./provider-package.js"
