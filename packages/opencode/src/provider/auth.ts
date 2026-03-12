import { Effect, ManagedRuntime } from "effect"
import z from "zod"

import { fn } from "@/util/fn"
import * as S from "./auth-service"
import { ProviderID } from "./schema"

const rt = ManagedRuntime.make(S.ProviderAuthService.defaultLayer)

function runPromise<A>(f: (service: S.ProviderAuthService.Service) => Effect.Effect<A, S.ProviderAuthError>) {
  return rt.runPromise(S.ProviderAuthService.use(f))
}

export namespace ProviderAuth {
  export const Method = z
    .object({
      type: z.union([z.literal("oauth"), z.literal("api")]),
      label: z.string(),
    })
    .meta({
      ref: "ProviderAuthMethod",
    })
  export type Method = z.infer<typeof Method>

  export async function methods() {
    return runPromise((service) => service.methods())
  }

  export const Authorization = z
    .object({
      url: z.string(),
      method: z.union([z.literal("auto"), z.literal("code")]),
      instructions: z.string(),
    })
    .meta({
      ref: "ProviderAuthAuthorization",
    })
  export type Authorization = z.infer<typeof Authorization>

  export const authorize = fn(
    z.object({
      providerID: ProviderID.zod,
      method: z.number(),
    }),
    async (input): Promise<Authorization | undefined> => runPromise((service) => service.authorize(input)),
  )

  export const callback = fn(
    z.object({
      providerID: ProviderID.zod,
      method: z.number(),
      code: z.string().optional(),
    }),
    async (input) => runPromise((service) => service.callback(input)),
  )

  export const api = fn(
    z.object({
      providerID: ProviderID.zod,
      key: z.string(),
    }),
    async (input) => runPromise((service) => service.api(input)),
  )

  export import OauthMissing = S.OauthMissing
  export import OauthCodeMissing = S.OauthCodeMissing
  export import OauthCallbackFailed = S.OauthCallbackFailed
}
