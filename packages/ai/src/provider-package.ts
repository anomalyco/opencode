import type { LanguageModel, ProviderOptions } from "./schema/index.js"
import type { CompactionOperations } from "./route/client.js"

export interface Settings extends Readonly<Record<string, unknown>> {
  readonly baseURL?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Readonly<Record<string, unknown>>
}

export interface Definition<
  ProviderSettings extends Settings = Settings,
  Options extends ProviderOptions = ProviderOptions,
  Compact extends CompactionOperations | undefined = CompactionOperations | undefined,
> {
  readonly model: (modelID: string, settings: ProviderSettings) => LanguageModel<Options, Compact>
}

export * as ProviderPackage from "./provider-package.js"
