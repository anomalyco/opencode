import { runPromiseInstance } from "@/effect/runtime"
import { fn } from "@/util/fn"
import { ProviderID } from "./schema"
import z from "zod"
import * as Mod from "./auth-service"

const methods = async () => {
  return runPromiseInstance(Mod.ProviderAuth.Service.use((svc) => svc.methods()))
}

const authorize = fn(
  z.object({
    providerID: ProviderID.zod,
    method: z.number(),
    inputs: z.record(z.string(), z.string()).optional(),
  }),
  async (input): Promise<ProviderAuth.Authorization | undefined> =>
    runPromiseInstance(Mod.ProviderAuth.Service.use((svc) => svc.authorize(input))),
)

const callback = fn(
  z.object({
    providerID: ProviderID.zod,
    method: z.number(),
    code: z.string().optional(),
  }),
  async (input) => runPromiseInstance(Mod.ProviderAuth.Service.use((svc) => svc.callback(input))),
)

export const ProviderAuth = {
  Method: Mod.ProviderAuth.Method,
  Authorization: Mod.ProviderAuth.Authorization,
  OauthMissing: Mod.ProviderAuth.OauthMissing,
  OauthCodeMissing: Mod.ProviderAuth.OauthCodeMissing,
  OauthCallbackFailed: Mod.ProviderAuth.OauthCallbackFailed,
  ValidationFailed: Mod.ProviderAuth.ValidationFailed,
  Service: Mod.ProviderAuth.Service,
  layer: Mod.ProviderAuth.layer,
  defaultLayer: Mod.ProviderAuth.defaultLayer,
  methods,
  authorize,
  callback,
}

export namespace ProviderAuth {
  export type Method = Mod.ProviderAuth.Method
  export type Authorization = Mod.ProviderAuth.Authorization
  export type Error = Mod.ProviderAuth.Error
  export type Interface = Mod.ProviderAuth.Interface
}
