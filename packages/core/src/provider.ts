export * as ProviderV2 from "./provider"

import { Types } from "effect"
import { Provider } from "@opencode-ai/schema/provider"
import { withStatics } from "./schema"

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

export const Info = Provider.Info.pipe(
  withStatics((schema) => ({
    empty(providerID: ID) {
      return schema.make({
        id: providerID,
        name: providerID,
        api: {
          type: "native",
          settings: {},
        },
        request: {
          headers: {},
          body: {},
        },
      })
    },
  })),
)
export type Info = Provider.Info

export type MutableInfo = Omit<Types.DeepMutable<Info>, "api"> & { api: MutableApi }
