import { runPromiseInstance } from "@/effect/runtime"
import { fn } from "@/util/fn"
import { ProviderID } from "./schema"
import z from "zod"
import { ProviderAuth as S } from "./auth-service"

export namespace ProviderAuth {
  export const Method = S.Method
  export type Method = S.Method

  export const Authorization = S.Authorization
  export type Authorization = S.Authorization

  export const OauthMissing = S.OauthMissing
  export const OauthCodeMissing = S.OauthCodeMissing
  export const OauthCallbackFailed = S.OauthCallbackFailed
  export const ValidationFailed = S.ValidationFailed
  export type Error = S.Error

  export type Interface = S.Interface

  export const Service = S.Service
  export const layer = S.layer
  export const defaultLayer = S.defaultLayer

  export async function methods() {
    return runPromiseInstance(S.Service.use((svc) => svc.methods()))
  }

  export const authorize = fn(
    z.object({
      providerID: ProviderID.zod,
      method: z.number(),
      inputs: z.record(z.string(), z.string()).optional(),
    }),
    async (input): Promise<Authorization | undefined> =>
      runPromiseInstance(S.Service.use((svc) => svc.authorize(input))),
  )

  export const callback = fn(
    z.object({
      providerID: ProviderID.zod,
      method: z.number(),
      code: z.string().optional(),
    }),
    async (input) => runPromiseInstance(S.Service.use((svc) => svc.callback(input))),
  )
}
