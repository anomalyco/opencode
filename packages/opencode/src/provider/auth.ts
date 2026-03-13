import { Effect, ManagedRuntime } from "effect"
import z from "zod"

import { fn } from "@/util/fn"
import * as S from "./auth-service"
import { ProviderID } from "./schema"

// Separate runtime: ProviderAuthService can't join the shared runtime because
// runtime.ts → auth-service.ts → provider/auth.ts creates a circular import.
// AuthService is stateless file I/O so the duplicate instance is harmless.
const rt = ManagedRuntime.make(S.ProviderAuthService.defaultLayer)

function runPromise<A>(f: (service: S.ProviderAuthService.Service) => Effect.Effect<A, S.ProviderAuthError>) {
  return rt.runPromise(S.ProviderAuthService.use(f))
}

export namespace ProviderAuth {
  export const Method = S.Method
  export type Method = S.Method

  export async function methods() {
    return runPromise((service) => service.methods())
  }

  export const Authorization = S.Authorization
  export type Authorization = S.Authorization

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
