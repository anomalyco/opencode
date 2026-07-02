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

export const Settings = Provider.Settings
export type Settings = Provider.Settings

export const Info = Provider.Info
export type Info = Provider.Info

export type MutableRequest = Types.DeepMutable<Request>

export type MutableInfo = Omit<Types.DeepMutable<Info>, "api" | "request"> & {
  api: MutableApi
  request: MutableRequest
}
