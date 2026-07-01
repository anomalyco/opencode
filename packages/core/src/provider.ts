export * as ProviderV2 from "./provider"

import { Types } from "effect"
import { Provider } from "@opencode-ai/schema/provider"

export const ID = Provider.ID
export type ID = typeof ID.Type

export const AISDK = Provider.AISDK

export const Native = Provider.Native

export const Api = Provider.Api
export type Api = Provider.Api
export type MutableApi<T extends Api = Api> = T extends Api
  ? Omit<Types.DeepMutable<T>, "settings"> & (undefined extends T["settings"] ? { settings?: any } : { settings: any })
  : never

export const Request = Provider.Request
export type Request = Provider.Request

export const ProviderOptions = Provider.ProviderOptions
export type ProviderOptions = Provider.ProviderOptions

export const mergeProviderOptions = (...items: ReadonlyArray<ProviderOptions | undefined>): ProviderOptions | undefined => {
  const result: Record<string, ProviderOptions[string]> = {}
  for (const item of items) {
    if (!item) continue
    for (const [provider, options] of Object.entries(item)) {
      result[provider] = { ...result[provider], ...options }
    }
  }
  return Object.keys(result).length === 0 ? undefined : result
}

export const Info = Provider.Info
export type Info = Provider.Info

export type MutableRequest = Omit<Types.DeepMutable<Request>, "providerOptions"> & { providerOptions?: ProviderOptions }

export type MutableInfo = Omit<Types.DeepMutable<Info>, "api" | "request"> & {
  api: MutableApi
  request: MutableRequest
}
