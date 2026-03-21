import { fn } from "@/util/fn"
import { ProviderID } from "./schema"
import z from "zod"
import { runPromise, ProviderAuth as S } from "./auth-service"

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
    return runPromise((svc) => svc.methods())
  }

  export const authorize = fn(
    z.object({
      providerID: ProviderID.zod,
      method: z.number(),
      inputs: z.record(z.string(), z.string()).optional(),
    }),
    async (input): Promise<Authorization | undefined> => runPromise((svc) => svc.authorize(input)),
  )

  export const callback = fn(
    z.object({
      providerID: ProviderID.zod,
      method: z.number(),
      code: z.string().optional(),
    }),
    async (input) => runPromise((svc) => svc.callback(input)),
  )
}
