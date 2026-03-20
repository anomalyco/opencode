import { Effect } from "effect"
import { runtime } from "@/effect/runtime"
import * as S from "./effect"
import * as Schema from "./schema"

export { OAUTH_DUMMY_KEY } from "./effect"

function runPromise<A>(f: (service: S.AuthEffect.Interface) => Effect.Effect<A, S.AuthError>) {
  return runtime.runPromise(S.AuthEffect.Service.use(f))
}

export namespace Auth {
  export const Oauth = Schema.Oauth
  export const Api = Schema.Api
  export const WellKnown = Schema.WellKnown
  export const Info = Schema.Info
  export type Info = Schema.Info

  export async function get(providerID: string) {
    return runPromise((service) => service.get(providerID))
  }

  export async function all(): Promise<Record<string, Info>> {
    return runPromise((service) => service.all())
  }

  export async function set(key: string, info: Info) {
    return runPromise((service) => service.set(key, info))
  }

  export async function remove(key: string) {
    return runPromise((service) => service.remove(key))
  }
}
