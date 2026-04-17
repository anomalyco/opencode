import { mergeDeep } from "remeda"

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

type ConfigProviderHookContext<T extends ProviderLike> = {
  providerID: string
  provider: ConfigProviderLike
  database: ProviderMap<T>
}

type MergeProviderHookContext<T extends ProviderLike> = ConfigProviderHookContext<T> & {
  provider: Partial<T> & ConfigProviderLike
  providers: ProviderMap<T>
}

export function extendConfigProvider<T extends ProviderLike>(input: ConfigProviderHookContext<T>) {
  if (!input.provider.extends) return
  const base = input.database[input.provider.extends]
  if (!base) return
  return mergeDeep({ ...base, id: input.providerID }, input.provider) as T
}

export function extendMergedProvider<T extends ProviderLike>(input: MergeProviderHookContext<T>) {
  const current = input.providers[input.providerID] ?? input.database[input.providerID]
  const next = mergeDeep(current ?? ({ id: input.providerID } as T), input.provider) as T
  if (!next.extends) return
  const base = input.database[next.extends]
  if (!base) return
  return mergeDeep({ ...base, id: input.providerID }, next) as T
}
