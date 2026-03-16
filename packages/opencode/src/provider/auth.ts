import z from "zod"

import { runPromiseInstance } from "@/effect/runtime"
import { fn } from "@/util/fn"
import * as S from "./auth-service"
import { ProviderID } from "./schema"

export namespace ProviderAuth {
  export const Method = S.Method
  export type Method = S.Method

  export async function methods() {
    return runPromiseInstance(S.ProviderAuthService.use((service) => service.methods()))
  }

  export const Authorization = S.Authorization
  export type Authorization = S.Authorization

  export const authorize = fn(
    z.object({
      providerID: ProviderID.zod,
      method: z.number(),
    }),
    async (input): Promise<Authorization | undefined> =>
      runPromiseInstance(S.ProviderAuthService.use((service) => service.authorize(input))),
  )

  export const callback = fn(
    z.object({
      providerID: ProviderID.zod,
      method: z.number(),
      code: z.string().optional(),
    }),
    async (input) => runPromiseInstance(S.ProviderAuthService.use((service) => service.callback(input))),
  )

  export import OauthMissing = S.OauthMissing
  export import OauthCodeMissing = S.OauthCodeMissing
  export import OauthCallbackFailed = S.OauthCallbackFailed
}
