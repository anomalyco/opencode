import { extendConfigProvider, extendMergedProvider } from "./patches/base-field/provider"

type ProviderLike = {
  id?: string
  extends?: string
  [key: string]: unknown
}

type ConfigProviderLike = {
  extends?: string
  [key: string]: unknown
}

type ProviderMap<T extends ProviderLike> = Record<string, T>

export interface ConfigProviderHookContext<T extends ProviderLike> {
  providerID: string
  provider: ConfigProviderLike
  database: ProviderMap<T>
}

export interface MergeProviderHookContext<T extends ProviderLike> extends ConfigProviderHookContext<T> {
  provider: Partial<T> & ConfigProviderLike
  providers: ProviderMap<T>
}

export interface CustomRelayProvider {
  onConfigProvider: <T extends ProviderLike>(input: ConfigProviderHookContext<T>) => T | undefined
  onMergeProvider: <T extends ProviderLike>(input: MergeProviderHookContext<T>) => T | undefined
}

export const customRelayProvider: CustomRelayProvider = {
  onConfigProvider(input) {
    return extendConfigProvider(input)
  },
  onMergeProvider(input) {
    return extendMergedProvider(input)
  },
}
